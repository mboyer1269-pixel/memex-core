import test from 'node:test';
import assert from 'node:assert';
import { 
    agentmemory_librarian_brief,
    agentmemory_latest_updates,
    agentmemory_project_state,
    agentmemory_tool_catalog_search
} from '../src/memory/librarian.ts';
import { initGraph, closeGraph, addEntity } from '../src/graph.ts';
import fs from 'node:fs';

test('Librarian Briefing limits output correctly with real data', (t) => {
    const ns = 'org:test_librarian';
    
    // Initialize an in-memory db
    initGraph(':memory:', false);

    for (let i = 0; i < 50; i++) {
        addEntity({
            id: `proj-${i}`,
            type: 'Project',
            namespace: ns,
            name: `Project ${i}`,
            properties: { desc: 'A'.repeat(50) }
        });
        addEntity({
            id: `skill-${i}`,
            type: 'Skill',
            namespace: ns,
            name: `deploy-skill-${i}`,
            properties: { desc: 'B'.repeat(50) }
        });
    }

    const task = "Some random task to do. " + "C".repeat(200); // large task to test budget math
    const budget = 100; // 400 chars max

    // librarian reads from DB internally; we initialized it globally with :memory:
    
    // Run test for budget 200 (800 chars)
    const budget200 = 200;
    const brief200 = agentmemory_librarian_brief(ns, task, budget200);
    assert.ok(brief200.length <= budget200 * 4, `Brief length (${brief200.length}) should be strictly <= ${budget200 * 4}`);
    assert.ok(brief200.includes('[TRUNCATED]'), "Brief 200 should contain [TRUNCATED] warning");

    // Run test for budget 1500 (6000 chars)
    const budget1500 = 1500;
    const brief1500 = agentmemory_librarian_brief(ns, task, budget1500);
    assert.ok(brief1500.length <= budget1500 * 4, `Brief length (${brief1500.length}) should be strictly <= ${budget1500 * 4}`);

    // Run test for budget 4000 (16000 chars)
    const budget4000 = 4000;
    const brief4000 = agentmemory_librarian_brief(ns, task, budget4000);
    assert.ok(brief4000.length <= budget4000 * 4, `Brief length (${brief4000.length}) should be strictly <= ${budget4000 * 4}`);

    // Test out of bounds (small)
    const briefSmall = agentmemory_librarian_brief(ns, task, 10);
    assert.ok(briefSmall.length <= 40, `Brief Small length (${briefSmall.length}) should be strictly <= 40 chars`);
    
    // Test large
    const briefLarge = agentmemory_librarian_brief(ns, task, 10000);
    assert.ok(briefLarge.length <= 40000, `Brief Large length (${briefLarge.length}) should be strictly <= 40000 chars`);

    // Test other endpoints
    const updates = agentmemory_latest_updates(ns, budget200);
    assert.ok(updates.length <= budget200 * 4, `Updates length (${updates.length}) should be strictly <= ${budget200 * 4}`);

    const state = agentmemory_project_state(ns, 200);
    assert.ok(state.length <= 200 * 4, `State length (${state.length}) should be strictly <= ${200 * 4}`);

    const search = agentmemory_tool_catalog_search(ns, "deploy", 200);
    assert.ok(search.length <= 200 * 4, `Search length (${search.length}) should be strictly within budget * 4`);
    
    t.after(() => {
        closeGraph();
    });
});

test('Stress test for librarian briefing header overflows', (t) => {
    const ns = 'org:stress2';
    
    // Write to test DB so agentmemory_librarian_brief can see it
    initGraph(':memory:', false);
    for (let i = 0; i < 50; i++) {
        try {
            addEntity({
                id: `stress-proj-${i}`,
                type: 'Project',
                namespace: ns,
                name: `Project ${i}`,
                properties: { desc: 'A'.repeat(500) }
            });
            addEntity({
                id: `stress-skill-${i}`,
                type: 'Skill',
                namespace: ns,
                name: `deploy-skill-${i}`,
                properties: { desc: 'B'.repeat(500) }
            });
        } catch (e) {}
    }
    
    addEntity({ id: `p1`, type: 'Project', namespace: ns, name: `P`, properties: { desc: 'A'.repeat(240) }});
    addEntity({ id: `s1`, type: 'Skill', namespace: ns, name: `S`, properties: { desc: 'B'.repeat(170) }});
    addEntity({ id: `d1`, type: 'Decision', namespace: ns, name: `D`, properties: { desc: 'C'.repeat(220) }}); // Update

    const task = "A".repeat(800); // Massive task
    const testBudgets = [200]; // Test exactly at the minimum limit

    for (const budget of testBudgets) {
        const charBudget = budget * 4;
        const brief = agentmemory_librarian_brief(ns, task, budget);
        
        console.log(`\n[STRESS TEST] Budget: ${budget} (Max chars: ${charBudget})`);
        console.log(`[STRESS TEST] Actual length: ${brief.length}`);
        
        assert.ok(brief.length <= charBudget, `Length ${brief.length} exceeds ${charBudget}`);

        const headers = ["## Task", "## Project State", "## Latest Updates", "## Tools"];
        for (const h of headers) {
            if (brief.includes(h.substring(0, 4)) && !brief.includes(h)) {
                assert.fail(`Static header truncated for ${h}`);
            }
        }

        // Check if the final [TRUNCATED] tag is mangled because of the join("\n\n") bug
        if (brief.includes("[TRUNC") && !brief.includes("[TRUNCATED]")) {
            console.error("Found mangled [TRUNCATED] tag due to enforceFinalBudget truncation!");
            assert.fail("Mangled [TRUNCATED] tag detected");
        }
    }
    
    t.after(() => {
        closeGraph();
    });
});
