build-programs:
	anchor build -p m_ext -- --features ibt --no-default-features
	@mv target/deploy/m_ext.so target/deploy/ibt.so
	@mv target/idl/m_ext.json target/idl/ibt.json
	@mv target/types/m_ext.ts target/types/ibt.ts
	anchor build -p m_ext -- --features no-yield --no-default-features
	@mv target/deploy/m_ext.so target/deploy/no_yield.so
	@mv target/idl/m_ext.json target/idl/no_yield.json
	@mv target/types/m_ext.ts target/types/no_yield.ts

test-programs:
	@yarn run jest --preset ts-jest --verbose tests/unit/m_ext.test.ts
	@cargo test