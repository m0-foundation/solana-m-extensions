build-programs:
	anchor build -p m_ext -- --features scaled-ui
	@mv target/deploy/m_ext.so target/deploy/scaled_ui.so
	@mv target/idl/m_ext.json target/idl/scaled_ui.json
	@mv target/types/m_ext.ts target/types/scaled_ui.ts
	anchor build -p m_ext -- --features no-yield
	@mv target/deploy/m_ext.so target/deploy/no_yield.so
	@mv target/idl/m_ext.json target/idl/no_yield.json
	@mv target/types/m_ext.ts target/types/no_yield.ts

test-programs:
	@yarn run jest --preset ts-jest --verbose