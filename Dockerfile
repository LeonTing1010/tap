# Tap MCP server — used by Glama and other MCP registries to build & inspect.
# Tap-core is proprietary; this Dockerfile installs the published npm package.
FROM node:20-slim

RUN npm install -g @taprun/cli@latest

# MCP server runs on stdin/stdout
ENTRYPOINT ["tap", "mcp", "start"]
