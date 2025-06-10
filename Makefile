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
	@yarn run jest --preset ts-jest --verbose tests/unit/**.test.ts
	@cargo testyar

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
