build-programs:
	anchor build -p ext_swap
	anchor build -p m_ext -- --features scaled-ui --no-default-features
	@mv target/deploy/m_ext.so target/deploy/scaled_ui.so
	@mv target/idl/m_ext.json target/idl/scaled_ui.json
	@mv target/types/m_ext.ts target/types/scaled_ui.ts
	anchor build -p m_ext -- --features no-yield --no-default-features
	@cp target/deploy/m_ext.so target/deploy/no_yield.so
	@cp target/idl/m_ext.json target/idl/no_yield.json
	@cp target/types/m_ext.ts target/types/no_yield.ts

test-programs:
	@pnpm jest --preset ts-jest --verbose tests/unit/**.test.ts; exit $$?
	@cargo test; exit $$?

define update-program-id
 	@echo "Updating program ID in m_ext/src/lib.rs to $(1)"
	@sed -i '' 's/declare_id!("[^"]*")/declare_id!("$(1)")/' programs/m_ext/src/lib.rs
endef

build-test-programs:
	$(call update-program-id,3joDhmLtHLrSBGfeAe1xQiv3gjikes3x8S4N3o6Ld8zB)
	anchor build -p m_ext
	@mv target/deploy/m_ext.so tests/programs/ext_a.so
	$(call update-program-id,HSMnbWEkB7sEQAGSzBPeACNUCXC9FgNeeESLnHtKfoy3)
	anchor build -p m_ext 
	@mv target/deploy/m_ext.so tests/programs/ext_b.so
	$(call update-program-id,81gYpXqg8ZT9gdkFSe35eqiitqBWqVfYwDwVfXuk8Xfw)
	sed -i '' '/pub ext_token_program: Program<'\''info, Token2022>,/a\'$$'\n''\ pub dummy_account: Program<'\''info, Token2022>,' programs/m_ext/src/instructions/wrap.rs
	cargo fmt
	anchor build -p m_ext --skip-lint
	@mv target/deploy/m_ext.so tests/programs/ext_c.so
	sed -i '' '/pub dummy_account: Program<'\''info, Token2022>,/d' programs/m_ext/src/instructions/wrap.rs
	$(call update-program-id,3C865D264L4NkAm78zfnDzQJJvXuU3fMjRUvRxyPi5da)
	anchor build -p m_ext

# Program deployment and upgrades
COMPUTE_UNIT_PRICE := 300000
MAX_SIGN_ATTEMPTS := 5

sign-in:
	@echo "Signing in and getting data from 1Password..."
	@op signin --account mzerolabs.1password.com
	@op read "$(PAYER_KEYPAIR)" > temp-payer-keypair.json

load-ext-keypair: sign-in
	@op read "$(EXT_PROGRAM_KEYPAIR)" > temp-ext-program-keypair.json

load-ext-swap-keypair: sign-in
	@op read "$(EXT_SWAP_PROGRAM_KEYPAIR)" > temp-ext-swap-program-keypair.json

prep-ext-program: load-ext-keypair
	$(call update-program-id,$(shell solana address -k temp-ext-program-keypair.json))
	@echo "Building $(VARIANT) ext program for the provided keypair..."
	@anchor build -p m_ext -- --features $(VARIANT) --no-default-features
	@mv target/deploy/m_ext.so target/deploy/temp.so
	@mv target/idl/m_ext.json target/idl/temp.json
	
clean-up-ext-program: 
	@echo "Cleaning up temporary files..."
	$(call update-program-id,3C865D264L4NkAm78zfnDzQJJvXuU3fMjRUvRxyPi5da)
	@rm temp-payer-keypair.json temp-ext-program-keypair.json target/deploy/temp.so target/idl/temp.json

# define build-verified-ext
# 	@echo "Building verified $(1) ext program...\n"
# 	solana-verify build --library-name m_ext -- --features $(1) --no-default-features
# endef

deploy-ext-program: prep-ext-program
	@echo "Deploying $(VARIANT) ext program..."
	solana program deploy \
		--url $(shell op read "$(RPC_URL)") \
		--with-compute-unit-price $(COMPUTE_UNIT_PRICE) \
		--keypair temp-payer-keypair.json \
		--max-sign-attempts $(MAX_SIGN_ATTEMPTS) \
		--program-id temp-ext-program-keypair.json \
		target/deploy/temp.so
	$(MAKE) clean-up-ext-program

verify-ext-idl: prep-ext-program
	@echo "Verifying the $(VARIANT) ext program IDL..."
	anchor idl init \
		-f target/idl/temp.json \
		--provider.cluster $(shell op read "$(RPC_URL)") \
		--provider.wallet temp-payer-keypair.json \
		$(shell solana address -k temp-ext-program-keypair.json)
	$(MAKE) clean-up-ext-program

create-temp-buffer: 
	@echo "Creating a temporary buffer for the program upgrade..."
	@solana-keygen new --no-bip39-passphrase --force -s --outfile=temp-buffer.json
	@echo "Buffer created at $(shell solana address -k temp-buffer.json)"

upgrade-ext-program: prep-ext-program create-temp-buffer
	@echo "Writing buffer for $(VARIANT) ext program..."
	@solana program write-buffer \
	    --url $(shell op read "$(RPC_URL)") \
		--with-compute-unit-price $(COMPUTE_UNIT_PRICE) \
		--keypair temp-payer-keypair.json \
		--max-sign-attempts $(MAX_SIGN_ATTEMPTS) \
		--buffer temp-buffer.json \
		target/deploy/temp.so
	@echo "Upgrading program with buffer $(shell solana address -k temp-buffer.json)" 
	@solana program upgrade \
		--url $(shell op read "$(RPC_URL)") \
		--keypair temp-payer-keypair.json \
		$(shell solana address -k temp-buffer.json) \
		$(shell solana address -k temp-ext-program-keypair.json)
	@rm temp-buffer.json
	$(MAKE) clean-up-ext-program

# Extension swap facility deployments

deploy-ext-swap: load-ext-swap-keypair
	@echo "Deploying the extension swap facility..."
	@anchor build -p ext_swap
	solana program deploy \
		--url $(shell op read "$(RPC_URL)") \
		--with-compute-unit-price $(COMPUTE_UNIT_PRICE) \
		--keypair temp-payer-keypair.json \
		--max-sign-attempts $(MAX_SIGN_ATTEMPTS) \
		--program-id temp-ext-swap-program-keypair.json \
		target/deploy/ext_swap.so
	@rm temp-payer-keypair.json temp-ext-swap-program-keypair.json
	@echo "Extension swap facility deployed successfully."

verify-ext-swap-idl: sign-in
	@echo "Verifying the extension swap facility IDL..."
	anchor idl init \
		-f target/idl/ext_swap.json \
		--provider.cluster $(shell op read "$(RPC_URL)") \
		--provider.wallet temp-payer-keypair.json \
		MSwapi3WhNKMUGm9YrxGhypgUEt7wYQH3ZgG32XoWzH
	@rm temp-payer-keypair.json
	@echo "Extension swap facility IDL verified successfully."

upgrade-ext-swap: sign-in create-temp-buffer
	@anchor build -p ext_swap
	@echo "Writing buffer for ext swap program..."	
	solana program write-buffer \
	    --url $(shell op read "$(RPC_URL)") \
		--with-compute-unit-price $(COMPUTE_UNIT_PRICE) \
		--keypair temp-payer-keypair.json \
		--max-sign-attempts $(MAX_SIGN_ATTEMPTS) \
		--buffer temp-buffer.json \
		target/deploy/ext_swap.so
	@echo "Upgrading program with buffer $(shell solana address -k temp-buffer.json)" 
	solana program upgrade \
		--url $(shell op read "$(RPC_URL)") \
		--keypair temp-payer-keypair.json \
		$(shell solana address -k temp-buffer.json) \
		MSwapi3WhNKMUGm9YrxGhypgUEt7wYQH3ZgG32XoWzH
	@rm temp-buffer.json temp-payer-keypair.json
	@echo "Extension swap facility upgraded successfully."