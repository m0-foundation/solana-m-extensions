build-all-yield-features:
	anchor build -p dynamic_ext -- --features transfer-hook,permissioned-wrapping,ibt --no-default-features
	@mv target/deploy/dynamic_ext.so target/deploy/ibt.so
	anchor build -p dynamic_ext -- --features transfer-hook,permissioned-wrapping,scaled-ui --no-default-features
	@mv target/deploy/dynamic_ext.so target/deploy/scaled-ui.so
	anchor build -p dynamic_ext -- --features transfer-hook,permissioned-wrapping,yield-crank --no-default-features
	@cp -f target/deploy/dynamic_ext.so target/deploy/yield-crank.so
