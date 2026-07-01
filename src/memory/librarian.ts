import { queryEntities, getTimeline } from '../graph.ts';
import type { Entity } from '../graph.ts';

export function normalizeTokenBudget(input: number): number {
    if (typeof input !== 'number' || isNaN(input)) return 1500;
    return Math.max(0, Math.floor(input));
}

export function truncateText(text: string, maxChars: number, suffix: string = "\n[TRUNCATED]"): string {
    if (maxChars <= 0) return "";
    if (text.length <= maxChars) return text;
    if (maxChars <= suffix.length) return suffix.substring(0, maxChars);
    return text.substring(0, maxChars - suffix.length) + suffix;
}



export function enforceFinalBudget(output: string, maxChars: number): string {
    if (output.length <= maxChars) return output;
    return output.substring(0, maxChars);
}

function formatEntity(entity: Entity): string {
    return JSON.stringify({
        id: entity.id,
        type: entity.type,
        name: entity.name,
        properties: entity.properties,
        createdAt: entity.createdAt
    });
}

function truncateToBudget(lines: string[], maxChars: number): string {
    if (maxChars <= 0) return "";
    const suffix = "\n[TRUNCATED]";
    let totalLen = 0;
    for (const line of lines) {
        totalLen += (totalLen > 0 ? line.length + 1 : line.length);
    }
    if (totalLen <= maxChars) {
        return lines.join('\n');
    }

    const effectiveBudget = Math.max(0, maxChars - suffix.length);
    let result = "";
    let truncated = true;
    for (const line of lines) {
        const addedLength = result.length > 0 ? line.length + 1 : line.length;
        if (result.length + addedLength > effectiveBudget) {
            break;
        }
        result += (result.length > 0 ? "\n" : "") + line;
    }
    
    if (truncated) {
        if (result.length + suffix.length <= maxChars) {
            result += suffix;
        } else {
            result = suffix.substring(0, maxChars);
        }
    }
    return result;
}

export function agentmemory_librarian_brief(namespace: string, task: string, tokenBudget: number): string {
    const normalizedTokenBudget = normalizeTokenBudget(tokenBudget);
    const maxChars = normalizedTokenBudget * 4;
    
    const taskBudget = Math.floor(maxChars * 0.10);
    const stateBudget = Math.floor(maxChars * 0.35);
    const updatesBudget = Math.floor(maxChars * 0.30);

    const taskSectionHeader = "## Task\n";
    const taskSection = taskSectionHeader + truncateText(task, Math.max(0, taskBudget - taskSectionHeader.length));

    // Querying data
    const updates = getTimeline(namespace);
    const allEntities = queryEntities({ namespace, limit: 500 });
    const stateEntities = allEntities.filter(e => ["Project", "Policy", "Service", "Decision"].includes(e.type));
    const tools = allEntities.filter(e => ["Skill", "Agent", "Workflow"].includes(e.type));

    const stateHeader = "## Project State\n";
    const stateSection = stateHeader + truncateToBudget(stateEntities.map(formatEntity), Math.max(0, stateBudget - stateHeader.length));
    
    const updatesHeader = "## Latest Updates\n";
    const updatesSection = updatesHeader + truncateToBudget(updates.map(formatEntity), Math.max(0, updatesBudget - updatesHeader.length));
    
    const usedLength = taskSection.length + stateSection.length + updatesSection.length + 6; // 6 for \n\n joins
    const toolsBudget = Math.max(0, maxChars - usedLength);

    const toolsHeader = "## Tools\n";
    const toolsSection = toolsHeader + truncateToBudget(tools.map(formatEntity), Math.max(0, toolsBudget - toolsHeader.length));

    const result = [taskSection, stateSection, updatesSection, toolsSection].join("\n\n");
    return enforceFinalBudget(result, maxChars);
}

export function agentmemory_latest_updates(namespace: string, tokenBudget: number = 1000): string {
    const maxChars = normalizeTokenBudget(tokenBudget) * 4;
    const updates = getTimeline(namespace);

    const lines = updates.map(formatEntity);
    const result = truncateToBudget(lines, maxChars);
    return enforceFinalBudget(result, maxChars);
}

export function agentmemory_project_state(namespace: string, tokenBudget: number = 1000): string {
    const maxChars = normalizeTokenBudget(tokenBudget) * 4;
    const entities = queryEntities({ namespace, limit: 500 }).filter(e => ["Project", "Policy", "Service", "Decision"].includes(e.type));

    const lines = entities.map(formatEntity);
    const result = truncateToBudget(lines, maxChars);
    return enforceFinalBudget(result, maxChars);
}

export function agentmemory_tool_catalog_search(namespace: string, intent: string, tokenBudget: number = 1000): string {
    const maxChars = normalizeTokenBudget(tokenBudget) * 4;
    const tools = queryEntities({ namespace, limit: 500 }).filter(e => ["Skill", "Agent", "Workflow"].includes(e.type));

    const lowerIntent = intent.toLowerCase();
    const filtered = tools.filter(t => 
        (t.name?.toLowerCase().includes(lowerIntent) || JSON.stringify(t.properties)?.toLowerCase().includes(lowerIntent))
    );
    const lines = filtered.map(formatEntity);
    const result = truncateToBudget(lines, maxChars);
    return enforceFinalBudget(result, maxChars);
}
