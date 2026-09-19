const fs = require('fs');

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  console.error('usage: ua-arch-analyze.js <input.json> <output.json>');
  process.exit(1);
}

try {
  const { fileNodes, importEdges, allEdges } = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

  const nodeById = new Map(fileNodes.map((n) => [n.id, n]));

  // A. Directory grouping
  const paths = fileNodes.map((n) => n.filePath);
  const splitDirs = (p) => p.split('/').slice(0, -1);
  let prefix = splitDirs(paths[0]);
  for (const p of paths) {
    const dirs = splitDirs(p);
    let i = 0;
    while (i < prefix.length && i < dirs.length && prefix[i] === dirs[i]) i++;
    prefix = prefix.slice(0, i);
  }
  const prefixLen = prefix.length;

  const directoryGroups = {};
  for (const n of fileNodes) {
    const dirs = splitDirs(n.filePath);
    const group = dirs.length > prefixLen ? dirs[prefixLen] : '(root)';
    (directoryGroups[group] ||= []).push(n.id);
  }

  // B. Node type grouping
  const nodeTypeGroups = {};
  for (const n of fileNodes) (nodeTypeGroups[n.type] ||= []).push(n.id);

  // C. Import adjacency: fan-in / fan-out
  const fileFanIn = {};
  const fileFanOut = {};
  for (const e of importEdges) {
    fileFanOut[e.source] = (fileFanOut[e.source] || 0) + 1;
    fileFanIn[e.target] = (fileFanIn[e.target] || 0) + 1;
  }

  const groupOf = {};
  for (const [g, ids] of Object.entries(directoryGroups)) for (const id of ids) groupOf[id] = g;

  // D. Cross-category dependency analysis
  const crossCounts = new Map();
  for (const e of allEdges) {
    const s = nodeById.get(e.source);
    const t = nodeById.get(e.target);
    if (!s || !t) continue;
    if (s.type === t.type && s.type === 'file') continue;
    const key = `${s.type}|${t.type}|${e.type}`;
    crossCounts.set(key, (crossCounts.get(key) || 0) + 1);
  }
  const crossCategoryEdges = [...crossCounts.entries()].map(([k, count]) => {
    const [fromType, toType, edgeType] = k.split('|');
    return { fromType, toType, edgeType, count };
  });

  // E. Inter-group import frequency + F. intra-group density
  const interCounts = new Map();
  const intra = {};
  for (const g of Object.keys(directoryGroups)) intra[g] = { internalEdges: 0, totalEdges: 0 };
  for (const e of importEdges) {
    const gs = groupOf[e.source];
    const gt = groupOf[e.target];
    if (!gs || !gt) continue;
    intra[gs].totalEdges++;
    if (gt !== gs) intra[gt].totalEdges++;
    if (gs === gt) {
      intra[gs].internalEdges++;
    } else {
      const key = `${gs}|${gt}`;
      interCounts.set(key, (interCounts.get(key) || 0) + 1);
    }
  }
  const interGroupImports = [...interCounts.entries()].map(([k, count]) => {
    const [from, to] = k.split('|');
    return { from, to, count };
  });
  const intraGroupDensity = {};
  for (const [g, v] of Object.entries(intra)) {
    intraGroupDensity[g] = { ...v, density: v.totalEdges ? v.internalEdges / v.totalEdges : 0 };
  }

  // G. Directory + file pattern matching
  const dirPatterns = [
    [['routes', 'api', 'controllers', 'endpoints', 'handlers', 'serializers', 'controller', 'routers', 'blueprints'], 'api'],
    [['services', 'core', 'lib', 'domain', 'logic', 'signals', 'internal', 'composables', 'mailers', 'jobs', 'channels'], 'service'],
    [['models', 'db', 'data', 'persistence', 'repository', 'entities', 'migrations', 'entity', 'sql', 'database', 'schema'], 'data'],
    [['components', 'views', 'pages', 'ui', 'layouts', 'screens'], 'ui'],
    [['middleware', 'plugins', 'interceptors', 'guards'], 'middleware'],
    [['utils', 'helpers', 'common', 'shared', 'tools', 'templatetags', 'pkg'], 'utility'],
    [['config', 'constants', 'env', 'settings', 'management', 'commands'], 'config'],
    [['__tests__', 'test', 'tests', 'spec', 'specs'], 'test'],
    [['types', 'interfaces', 'schemas', 'contracts', 'dtos', 'dto', 'request', 'response'], 'types'],
    [['hooks'], 'hooks'],
    [['store', 'state', 'reducers', 'actions', 'slices'], 'state'],
    [['assets', 'static', 'public'], 'assets'],
    [['cmd', 'bin'], 'entry'],
    [['docs', 'documentation', 'wiki'], 'documentation'],
    [['deploy', 'deployment', 'infra', 'infrastructure', 'k8s', 'kubernetes', 'helm', 'charts', 'terraform', 'tf', 'docker'], 'infrastructure'],
    [['.github', '.gitlab', '.circleci'], 'ci-cd'],
  ];
  const patternMatches = {};
  for (const g of Object.keys(directoryGroups)) {
    const hit = dirPatterns.find(([names]) => names.includes(g.toLowerCase()));
    if (hit) patternMatches[g] = hit[1];
  }

  const filePatternMatches = {};
  for (const n of fileNodes) {
    const p = n.filePath;
    const base = n.name;
    let m = null;
    if (/(\.test\.|\.spec\.|^test_.*\.py$|_test\.go$|Test\.java$|_spec\.rb$|Test\.php$|Tests\.cs$)/.test(base)) m = 'test';
    else if (/\.d\.ts$/.test(base)) m = 'types';
    else if (/^(index\.(ts|js)|__init__\.py)$/.test(base)) m = 'entry';
    else if (base === 'manage.py' && !p.includes('/')) m = 'entry';
    else if (/^(wsgi|asgi)\.py$/.test(base)) m = 'config';
    else if (base === 'main.go' && /^cmd\//.test(p)) m = 'entry';
    else if (/^(main|lib)\.rs$/.test(base) && /^src\//.test(p)) m = 'entry';
    else if (/^(Application\.java|Program\.cs|config\.ru)$/.test(base)) m = 'entry';
    else if (/^(Cargo\.toml|go\.mod|Gemfile|pom\.xml|build\.gradle|composer\.json)$/.test(base)) m = 'config';
    else if (base === 'Dockerfile' || /^docker-compose\./.test(base)) m = 'infrastructure';
    else if (/\.(tf|tfvars)$/.test(base) || base === 'Makefile') m = 'infrastructure';
    else if (/^\.github\/workflows\//.test(p) || base === '.gitlab-ci.yml' || base === 'Jenkinsfile') m = 'ci-cd';
    else if (/\.sql$/.test(base)) m = 'data';
    else if (/\.(graphql|gql|proto)$/.test(base)) m = 'types';
    else if (/\.(md|rst)$/.test(base)) m = 'documentation';
    if (m) filePatternMatches[n.id] = m;
  }

  // H. Deployment topology
  const infraFiles = fileNodes
    .filter((n) => {
      const p = n.filePath;
      return (
        /(^|\/)(Dockerfile|docker-compose\.[^/]+|Makefile)$/.test(p) ||
        /\.(tf|tfvars)$/.test(p) ||
        /\.github\/workflows\//.test(p) ||
        /(^|\/)\.gitlab-ci\.yml$/.test(p) ||
        /(^|\/)Jenkinsfile$/.test(p)
      );
    })
    .map((n) => n.filePath);
  const deploymentTopology = {
    hasDockerfile: infraFiles.some((f) => /Dockerfile/.test(f)),
    hasCompose: infraFiles.some((f) => /docker-compose/.test(f)),
    hasK8s: paths.some((p) => /(^|\/)(k8s|kubernetes|helm|charts)\//.test(p)),
    hasTerraform: infraFiles.some((f) => /\.tf(vars)?$/.test(f)),
    hasCI: infraFiles.some((f) => /workflows|gitlab-ci|Jenkinsfile/.test(f)),
    infraFiles,
  };

  // I. Data pipeline detection
  const dataPipeline = {
    schemaFiles: paths.filter((p) => /(schema\.(sql|graphql|prisma)|\.proto)$/.test(p)),
    migrationFiles: paths.filter((p) => /migrations\//.test(p)),
    dataModelFiles: fileNodes.filter((n) => (n.tags || []).includes('data-model')).map((n) => n.filePath),
    apiHandlerFiles: fileNodes.filter((n) => (n.tags || []).includes('api-handler')).map((n) => n.filePath),
  };

  // J. Documentation coverage
  const docPaths = fileNodes.filter((n) => /\.(md|rst)$/.test(n.name)).map((n) => n.filePath);
  const groups = Object.keys(directoryGroups);
  const groupsWithDocsList = groups.filter((g) => {
    const ids = directoryGroups[g];
    return ids.some((id) => /\.(md|rst)$/.test(nodeById.get(id).name));
  });
  const docCoverage = {
    groupsWithDocs: groupsWithDocsList.length,
    totalGroups: groups.length,
    coverageRatio: groups.length ? +(groupsWithDocsList.length / groups.length).toFixed(2) : 0,
    undocumentedGroups: groups.filter((g) => !groupsWithDocsList.includes(g)),
    docFiles: docPaths,
  };

  // K. Dependency direction
  const pairNet = new Map();
  for (const { from, to, count } of interGroupImports) {
    const key = from < to ? `${from}|${to}` : `${to}|${from}`;
    const entry = pairNet.get(key) || { a: key.split('|')[0], b: key.split('|')[1], aToB: 0, bToA: 0 };
    if (from === entry.a) entry.aToB += count;
    else entry.bToA += count;
    pairNet.set(key, entry);
  }
  const dependencyDirection = [...pairNet.values()].map((e) =>
    e.aToB >= e.bToA
      ? { dependent: e.a, dependsOn: e.b }
      : { dependent: e.b, dependsOn: e.a }
  );

  const filesPerGroup = {};
  for (const [g, ids] of Object.entries(directoryGroups)) filesPerGroup[g] = ids.length;
  const nodeTypeCounts = {};
  for (const [t, ids] of Object.entries(nodeTypeGroups)) nodeTypeCounts[t] = ids.length;

  const result = {
    scriptCompleted: true,
    commonPrefix: prefix.join('/'),
    directoryGroups,
    nodeTypeGroups,
    crossCategoryEdges,
    interGroupImports,
    intraGroupDensity,
    patternMatches,
    filePatternMatches,
    deploymentTopology,
    dataPipeline,
    docCoverage,
    dependencyDirection,
    fileStats: { totalFileNodes: fileNodes.length, filesPerGroup, nodeTypeCounts },
    fileFanIn,
    fileFanOut,
  };

  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  process.exit(0);
} catch (err) {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
}
