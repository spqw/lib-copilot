.PHONY: install build dev test help clean

help:
	@echo "lib-copilot - Direct Copilot API client"
	@echo ""
	@echo "Commands:"
	@echo "  make install      - Install dependencies"
	@echo "  make build        - Build TypeScript to JavaScript"
	@echo "  make dev          - Run in development mode"
	@echo "  make test         - Run tests"
	@echo "  make example:chat - Run chat example"
	@echo "  make example:completion - Run completion example"
	@echo "  make cli          - Run CLI tool"
	@echo "  make clean        - Remove build artifacts"
	@echo ""

install:
	npm install

build:
	npm run build

dev:
	npm run dev

test:
	npm run test

example\:chat:
	npm run example:chat

example\:completion:
	npm run example:completion

cli:
	npm run cli

clean:
	rm -rf node_modules dist .cache
	find . -name "*.log" -delete

.DEFAULT_GOAL := help
