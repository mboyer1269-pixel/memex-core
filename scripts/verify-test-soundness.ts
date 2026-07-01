import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(__dirname, '../src/mcp/server.ts');

const originalServerCode = fs.readFileSync(serverPath, 'utf-8');

// We mutate the server to return garbage string
const mutatedServerCode = originalServerCode.replace(
    /const result = agentmemory_tool_catalog_search\(namespace, intent, tokenBudget\);/,
    `const result = "GARBAGE DATA NO VALID RESULT";`
);

fs.writeFileSync(serverPath, mutatedServerCode);

let isSound = false;
try {
    console.log("Running mcp-server.test.ts with mutated server (returning garbage)...");
    execSync('node --experimental-strip-types --no-warnings --test tests/mcp-server.test.ts', { stdio: 'inherit' });
    console.log("\n❌ TEST PASSED EVEN THOUGH SERVER IS BROKEN! The test is not sound.");
    console.log("The test only asserts that the tool returned 'text' format, completely ignoring the content.");
} catch (e) {
    console.log("\n✅ Test failed. The test successfully caught the mutation. It is sound.");
    isSound = true;
} 

// We mutate the server to throw an error 
const mutatedServerCodeWithError = originalServerCode.replace(
    /const result = agentmemory_tool_catalog_search\(namespace, intent, tokenBudget\);/,
    `throw new Error("Simulated Server Crash");`
);
fs.writeFileSync(serverPath, mutatedServerCodeWithError);

try {
    console.log("\nRunning mcp-server.test.ts with mutated server (throwing an error)...");
    execSync('node --experimental-strip-types --no-warnings --test tests/mcp-server.test.ts', { stdio: 'inherit' });
    console.log("\n❌ TEST PASSED EVEN THOUGH SERVER THREW AN ERROR! The test is not sound.");
    console.log("The test caught the '{warnings:[...]}' fallback output from the server catch block and considered it valid text.");
} catch (e) {
    console.log("\n✅ Test failed. The test successfully caught the mutation. It is sound.");
} finally {
    fs.writeFileSync(serverPath, originalServerCode);
}
