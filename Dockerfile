FROM denoland/deno:2.2.2

WORKDIR /app

# Copy source
COPY src/ src/
COPY deno.json .

# Cache dependencies
RUN deno cache --no-check src/cli.ts

# MCP server runs on stdin/stdout
ENTRYPOINT ["deno", "run", "--allow-all", "--no-check", "--unstable-worker-options", "src/cli.ts", "mcp"]