export function selectPlaywrightServer(args) {
  const projects = selectedProjects(args);
  const mocked = projects.has("chromium-mocked");
  const standalone = projects.has("standalone-smoke");
  if (mocked && !standalone) return "mocked";
  if (standalone && !mocked) return "standalone";
  return "both";
}

function selectedProjects(args) {
  const projects = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument.startsWith("--project=")) projects.add(argument.slice("--project=".length));
    if (argument === "--project" && args[index + 1]) projects.add(args[index + 1]);
  }
  return projects;
}
