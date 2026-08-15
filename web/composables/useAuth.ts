export type User = {
  id: string;
  handle: string;
  name: string;
  email: string;
  bio: string;
};

export const useAuth = () => {
  const user = useState<User | null>("auth-user", () => null);
  const ready = useState<boolean>("auth-ready", () => false);

  async function refresh() {
    try {
      const data = await api<{ user: User | null }>("/api/auth/me");
      user.value = data.user;
    } catch {
      user.value = null;
    } finally {
      ready.value = true;
    }
  }

  async function login(handle: string, password: string) {
    const data = await api<{ user: User }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ handle, password }),
    });
    user.value = data.user;
    return data.user;
  }

  async function register(payload: { handle: string; name: string; password: string; bio?: string }) {
    const data = await api<{ user: User }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    user.value = data.user;
    return data.user;
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    user.value = null;
  }

  return { user, ready, refresh, login, register, logout };
};
