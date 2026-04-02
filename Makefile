.PHONY: compile test clean lint

compile:
	npx hardhat compile

test:
	npx hardhat test

clean:
	npx hardhat clean

lint:
	@if [ -x ./node_modules/.bin/solhint ]; then \
		./node_modules/.bin/solhint contracts/*.sol; \
	elif command -v solhint >/dev/null 2>&1; then \
		solhint contracts/*.sol; \
	else \
		echo "Skipping lint: solhint is not installed."; \
	fi
