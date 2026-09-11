export function dshPermissionResult(approved) {
  if (!approved) {
    return { outcome: { outcome: "cancelled" } };
  }
  return {
    outcome: {
      outcome: "selected",
      optionId: "allow-once",
    },
  };
}
