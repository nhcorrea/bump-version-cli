export function classifyRegistryVersionResult(result) {
  if (result.error) {
    return {
      kind: "registry-error",
      diagnostic: result.error.message,
    };
  }

  if (result.status === 0) {
    return { kind: "exists" };
  }

  const diagnostic = `${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim();

  if (/\bE404\b|404 Not Found/i.test(diagnostic)) {
    return { kind: "available" };
  }

  return { kind: "registry-error", diagnostic };
}
