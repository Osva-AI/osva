# @osva/sdk

Official TypeScript and JavaScript SDK for OSVA.

Requires Node.js 24 or newer.

## Installation

```bash
npm install @osva/sdk@1.0.0
```

## Usage

Set environment variables:

```bash
export OSVA_BASE_URL=http://127.0.0.1:8080
export OSVA_API_KEY=osva_ak_...
```

Example:

```js
import { OsvaClient } from "@osva/sdk";

const baseUrl = process.env.OSVA_BASE_URL;
const apiKey = process.env.OSVA_API_KEY;

if (!baseUrl || !apiKey) {
  throw new Error("OSVA_BASE_URL and OSVA_API_KEY are required");
}

const client = new OsvaClient({ baseUrl, apiKey });

const agents = await client.agents.list();
console.log(agents);
```

## Links

- Repository: https://github.com/Osva-AI/osva
- OSS 1.0 quickstart: https://github.com/Osva-AI/osva/blob/main/docs/OSS-1.0-QUICKSTART.md

## License

Apache-2.0
