import test from 'node:test';
import assert from 'node:assert';
import { extractKeywords, clusterByKeywords, distillPrompt } from '../src/ai/distill.ts';

test('Procedural Distillation — R3 (deterministic clustering)', async (t) => {
  await t.test('extractKeywords drops short words and stopwords', () => {
    const keywords = extractKeywords('This is the way we deploy the API gateway with Docker');
    assert.ok(keywords.has('deploy'));
    assert.ok(keywords.has('gateway'));
    assert.ok(keywords.has('docker'));
    assert.ok(!keywords.has('this'), 'stopword removed');
    assert.ok(!keywords.has('the'), 'short word removed');
    assert.ok(!keywords.has('way'), 'len<=3 removed');
  });

  await t.test('similar traces cluster together, dissimilar ones split', () => {
    const traces = [
      { id: 't1', content: 'episodic: deployed vercel project with environment variables and build cache' },
      { id: 't2', content: 'episodic: deployed vercel project again, environment variables missing, build failed' },
      { id: 't3', content: 'episodic: vercel deployment worked after setting environment variables build cache' },
      { id: 't4', content: 'episodic: cooked pasta carbonara recipe guanciale pecorino tonight' },
    ];

    const clusters = clusterByKeywords(traces);
    const bigCluster = clusters.find(c => c.size === 3);
    assert.ok(bigCluster, 'the three vercel traces should form one cluster');
    assert.deepStrictEqual(bigCluster!.ids.sort(), ['t1', 't2', 't3']);

    const loner = clusters.find(c => c.ids.includes('t4'));
    assert.ok(loner);
    assert.strictEqual(loner!.size, 1, 'the pasta trace stays alone');
  });

  await t.test('clustering is deterministic for identical input', () => {
    const traces = [
      { id: 'a', content: 'episodic: rotate api tokens quarterly using vault policy automation' },
      { id: 'b', content: 'episodic: rotated api tokens with vault policy automation checklist' },
      { id: 'c', content: 'episodic: sqlite migration backfill entities relations tables' },
    ];
    const run1 = clusterByKeywords(traces);
    const run2 = clusterByKeywords(traces);
    assert.deepStrictEqual(
      run1.map(c => ({ topic: c.topic, ids: c.ids })),
      run2.map(c => ({ topic: c.topic, ids: c.ids }))
    );
  });

  await t.test('topic is the most frequent shared keyword', () => {
    const traces = [
      { id: 'a', content: 'backup database nightly backup rotation' },
      { id: 'b', content: 'backup database weekly backup verification' },
    ];
    const clusters = clusterByKeywords(traces);
    assert.strictEqual(clusters.length, 1);
    assert.strictEqual(clusters[0].topic, 'backup');
  });

  await t.test('empty and keyword-less traces are skipped safely', () => {
    const clusters = clusterByKeywords([
      { id: 'x', content: '' },
      { id: 'y', content: 'a b c' },
    ]);
    assert.strictEqual(clusters.length, 0);
  });

  await t.test('distillPrompt embeds topic and all traces', () => {
    const prompt = distillPrompt({
      topic: 'deploy',
      ids: ['t1', 't2'],
      contents: ['first trace body', 'second trace body'],
      size: 2
    });
    assert.ok(prompt.includes('Topic: deploy'));
    assert.ok(prompt.includes('first trace body'));
    assert.ok(prompt.includes('second trace body'));
    assert.ok(prompt.includes('Standard Operating Procedure'));
  });
});
