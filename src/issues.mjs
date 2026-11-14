export function issue(level, file, message) {
  return { level, file, message };
}

export function hasErrors(issues) {
  return issues.some((item) => item.level === "error");
}

export function countIssues(issues) {
  return {
    errors: issues.filter((item) => item.level === "error").length,
    warnings: issues.filter((item) => item.level === "warning").length,
  };
}
