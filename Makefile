sign-in:
	@op signin --account mzerolabs.1password.com

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

# define build-verified-ext
# 	@echo "Building verified $(1) ext program...\n"
# 	solana-verify build --library-name m_ext -- --features $(1) --no-default-features
# endef

define deploy-ext-program
	@echo "\Building $(1) ext program for the provided keypair..."
	@op read "$(PAYER_KEYPAIR)" > temp-payer-keypair.json
	@op read "$(EXT_PROGRAM_KEYPAIR)" > temp-ext-program-keypair.json
	$(call update-program-id,$(shell solana address -k temp-ext-program-keypair.json))
	anchor build -p m_ext -- --features $(1) --no-default-features
	@mv target/deploy/m_ext.so target/deploy/temp.so
	@echo "\nDeploying $(1) ext program..."
	solana program deploy \
		--url $(shell op read "$(RPC_URL)") \
		--with-compute-unit-price $(COMPUTE_UNIT_PRICE) \
		--keypair temp-payer-keypair.json \
		--max-sign-attempts $(MAX_SIGN_ATTEMPTS) \
		--program-id temp-ext-program-keypair.json \
		target/deploy/temp.so
	$(call update-program-id,3C865D264L4NkAm78zfnDzQJJvXuU3fMjRUvRxyPi5da)
	@rm temp-payer-keypair.json temp-ext-program-keypair.json target/deploy/temp.so
endef

define verify-idl
	@echo "\nVerifying the $(1) ext program IDL..."
	@op read "$(PAYER_KEYPAIR)" > temp-payer-keypair.json
	@op read "$(EXT_PROGRAM_KEYPAIR)" > temp-ext-program-keypair.json
	$(call update-program-id,$(shell solana address -k temp-ext-program-keypair.json))
	anchor build -p m_ext -- --features $(1) --no-default-features
	@mv target/idl/m_ext.json target/idl/temp.json
	anchor idl init \
		-f target/idl/temp.json \
		--provider.cluster $(shell op read "$(RPC_URL)") \
		--provider.wallet temp-payer-keypair.json \
		$(shell solana address -k temp-ext-program-keypair.json)
	$(call update-program-id,3C865D264L4NkAm78zfnDzQJJvXuU3fMjRUvRxyPi5da)
	@rm temp-payer-keypair.json temp-ext-program-keypair.json target/idl/temp.json
endef

define upgrade-ext-program
	@solana-keygen new --no-bip39-passphrase --force -s --outfile=temp-buffer.json
	@echo "\nWriting buffer for $(1) ext program..."
	@op read "$(PAYER_KEYPAIR)" > temp-payer-keypair.json
	@solana program write-buffer \
	    --url $(shell op read "$(RPC_URL)") \
		--with-compute-unit-price $(COMPUTE_UNIT_PRICE) \
		--keypair temp-payer-keypair.json \
		--max-sign-attempts $(MAX_SIGN_ATTEMPTS) \
		--buffer temp-buffer.json \
		target/deploy/$(1).so 
	@echo "Upgrading program with buffer $$(solana address --keypair temp-buffer.json)" 
	@solana program upgrade \
		--keypair temp-payer-keypair.json \
		$$(solana address --keypair temp-buffer.json) \
		$(2)  
	@rm temp-buffer.json temp-payer-keypair.json
endef

# build-verified-no-yield-ext:
# 	$(call build-verified-ext,no-yield)

# build-verified-scaled-ui-ext:
# 	$(call build-verified-ext,scaled-ui)

deploy-scaled-ui-ext: sign-in
	$(call deploy-ext-program,scaled-ui)

deploy-no-yield-ext: sign-in
	$(call deploy-ext-program,no-yield)

verify-idl-scaled-ui-ext: sign-in
	$(call verify-idl,scaled-ui)

verify-idl-no-yield-ext: sign-in
	$(call verify-idl,no-yield)
