const fs = require('fs');

function main() {
	const [, , inputPath, outputPath] = process.argv;
	if (!inputPath || !outputPath) {
		console.error('Usage: node ua-tour-analyze.js <input.json> <output.json>');
		process.exit(1);
	}
	const { nodes, edges, layers } = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

	const fanIn = new Map();
	const fanOut = new Map();
	for (const n of nodes) {
		fanIn.set(n.id, 0);
		fanOut.set(n.id, 0);
	}
	for (const e of edges) {
		if (fanOut.has(e.source)) fanOut.set(e.source, fanOut.get(e.source) + 1);
		if (fanIn.has(e.target)) fanIn.set(e.target, fanIn.get(e.target) + 1);
	}

	const byId = new Map(nodes.map((n) => [n.id, n]));

	const fanInRanking = [...fanIn.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 20)
		.map(([id, v]) => ({ id, fanIn: v, name: byId.get(id).name }));

	const fanOutRanking = [...fanOut.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 20)
		.map(([id, v]) => ({ id, fanOut: v, name: byId.get(id).name }));

	// Entry point candidates
	const entryNames = new Set([
		'index.ts', 'index.js', 'main.ts', 'main.js', 'app.ts', 'app.js',
		'server.ts', 'server.js', 'mod.rs', 'main.go', 'main.py', 'main.rs',
		'manage.py', 'app.py', 'wsgi.py', 'asgi.py', 'run.py', '__main__.py',
		'Application.java', 'Main.java', 'Program.cs', 'config.ru', 'index.php',
		'App.swift', 'Application.kt', 'main.cpp', 'main.c',
	]);
	const fanOutVals = [...fanOut.values()].sort((a, b) => b - a);
	const fanInVals = [...fanIn.values()].sort((a, b) => a - b);
	const topFanOutCut = fanOutVals[Math.max(0, Math.ceil(fanOutVals.length * 0.1) - 1)] ?? 0;
	const lowFanInCut = fanInVals[Math.max(0, Math.ceil(fanInVals.length * 0.25) - 1)] ?? 0;

	const candidates = [];
	for (const n of nodes) {
		let score = 0;
		const depth = n.filePath.split('/').length;
		if (n.type === 'document') {
			if (n.filePath === 'README.md') score += 5;
			else if (depth === 1 && n.filePath.endsWith('.md')) score += 2;
		} else if (n.type === 'file') {
			if (entryNames.has(n.name) || /^alchemy\.run\.(ts|js)$/.test(n.name)) score += 3;
			if (depth <= 2) score += 1;
			if (fanOut.get(n.id) >= topFanOutCut && fanOut.get(n.id) > 0) score += 1;
			if (fanIn.get(n.id) <= lowFanInCut) score += 1;
		}
		if (score > 0) candidates.push({ id: n.id, score, name: n.name, summary: n.summary, type: n.type, fanIn: fanIn.get(n.id), fanOut: fanOut.get(n.id) });
	}
	candidates.sort((a, b) => b.score - a.score || b.fanOut - a.fanOut);
	const entryPointCandidates = candidates.slice(0, 5);

	// BFS from top code entry point
	const codeCandidates = candidates.filter((c) => c.type === 'file');
	const adj = new Map();
	for (const e of edges) {
		if (e.type === 'imports' || e.type === 'calls') {
			if (!adj.has(e.source)) adj.set(e.source, []);
			adj.get(e.source).push(e.target);
		}
	}
	let bfsTraversal = null;
	if (codeCandidates.length > 0) {
		const start = codeCandidates[0].id;
		const depthMap = { [start]: 0 };
		const order = [start];
		const queue = [start];
		while (queue.length) {
			const cur = queue.shift();
			for (const next of adj.get(cur) || []) {
				if (!(next in depthMap)) {
					depthMap[next] = depthMap[cur] + 1;
					order.push(next);
					queue.push(next);
				}
			}
		}
		const byDepth = {};
		for (const [id, d] of Object.entries(depthMap)) {
			(byDepth[d] ??= []).push(id);
		}
		bfsTraversal = { startNode: start, order, depthMap, byDepth };
	}

	// Non-code inventory
	const nonCodeFiles = { documentation: [], infrastructure: [], data: [], config: [] };
	for (const n of nodes) {
		const rec = { id: n.id, name: n.name, type: n.type, summary: n.summary };
		if (n.type === 'document') nonCodeFiles.documentation.push(rec);
		else if (['service', 'pipeline', 'resource'].includes(n.type)) nonCodeFiles.infrastructure.push(rec);
		else if (['table', 'schema', 'endpoint'].includes(n.type)) nonCodeFiles.data.push(rec);
		else if (n.type === 'config') nonCodeFiles.config.push(rec);
	}

	// Clusters: bidirectional pairs, expand with nodes connecting to 2+ members
	const pairEdges = new Map();
	for (const e of edges) {
		const key = [e.source, e.target].sort().join('|');
		pairEdges.set(key, (pairEdges.get(key) || 0) + 1);
	}
	const hasEdge = (a, b, t) => edges.some((e) => e.source === a && e.target === b && (!t || e.type === t));
	const clusters = [];
	const seen = new Set();
	for (const a of nodes) {
		for (const b of nodes) {
			if (a.id >= b.id) continue;
			const bidir = (hasEdge(a.id, b.id, 'imports') && hasEdge(b.id, a.id, 'imports')) ||
				(hasEdge(a.id, b.id, 'calls') && hasEdge(b.id, a.id, 'calls'));
			if (!bidir) continue;
			const key = [a.id, b.id].join('|');
			if (seen.has(key)) continue;
			seen.add(key);
			const cluster = new Set([a.id, b.id]);
			for (const c of nodes) {
				if (cluster.has(c.id)) continue;
				let links = 0;
				for (const m of cluster) {
					if (hasEdge(c.id, m) || hasEdge(m, c.id)) links++;
				}
				if (links >= 2 && cluster.size < 5) cluster.add(c.id);
			}
			const members = [...cluster];
			let edgeCount = 0;
			for (const e of edges) {
				if (cluster.has(e.source) && cluster.has(e.target)) edgeCount++;
			}
			clusters.push({ nodes: members, edgeCount });
		}
	}
	clusters.sort((a, b) => b.edgeCount - a.edgeCount);

	const nodeSummaryIndex = {};
	for (const n of nodes) {
		nodeSummaryIndex[n.id] = { name: n.name, type: n.type, summary: n.summary };
	}

	const result = {
		scriptCompleted: true,
		entryPointCandidates,
		fanInRanking,
		fanOutRanking,
		bfsTraversal,
		nonCodeFiles,
		clusters: clusters.slice(0, 10),
		layers: { count: layers.length, list: layers },
		nodeSummaryIndex,
		totalNodes: nodes.length,
		totalEdges: edges.length,
	};
	fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
	console.log('OK');
}

try {
	main();
} catch (err) {
	console.error(err && err.stack || String(err));
	process.exit(1);
}
