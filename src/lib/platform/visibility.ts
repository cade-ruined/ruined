export function isMyRuinedVisible() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.NEXT_PUBLIC_MY_RUINED_ENABLED === "true"
  );
}
