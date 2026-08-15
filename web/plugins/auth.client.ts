export default defineNuxtPlugin(async () => {
  const { refresh } = useAuth();
  await refresh();
});
