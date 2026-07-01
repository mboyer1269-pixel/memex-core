import { agentmemory_librarian_brief } from './memory/librarian.ts';
import { initGraph, closeGraph } from './graph.ts';

function main() {
    const args = process.argv.slice(2);
    let task = "General inquiry";
    let tokenBudget = 1000;
    let namespace = "global";

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '-Task' && i + 1 < args.length) {
            task = args[i + 1];
            i++;
        } else if (args[i] === '-TokenBudget' && i + 1 < args.length) {
            tokenBudget = Number(args[i + 1]);
            i++;
        } else if (args[i] === '-Namespace' && i + 1 < args.length) {
            namespace = args[i + 1];
            i++;
        }
    }

    try {
        initGraph();
        const result = agentmemory_librarian_brief(namespace, task, tokenBudget);
        console.log(result);
    } catch (err: any) {
        console.error("Error generating brief:", err.message);
        process.exitCode = 1;
    } finally {
        closeGraph();
    }
}

main();
