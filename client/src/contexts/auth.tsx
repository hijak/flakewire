import { createContext, useContext, useEffect, useMemo, useState } from 'react'

type User = { id: string; username: string } | null

type AuthContextType = {
  user: User
  token: string | null
  loading: boolean
  login: (username: string, password: string) => Promise<boolean>
  register: (username: string, email: string, password: string) => Promise<boolean>
  logout: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User>(null)
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'))
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const t = localStorage.getItem('token')
    if (!t) return void setLoading(false)
    fetch('/api/users/me', { headers: { Authorization: `Bearer ${t}` } })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('unauthorized'))))
      .then(u => { setUser(u); setToken(t); })
      .catch(() => { localStorage.removeItem('token'); setUser(null); setToken(null) })
      .finally(() => setLoading(false))
  }, [])

  const login = async (username: string, password: string) => {
    try {
      const r = await fetch('/api/users/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })
      const data = await r.json()
      if (!r.ok) return false
      setUser(data.user); setToken(data.token); localStorage.setItem('token', data.token)
      return true
    } catch {
      return false
    }
  }

  const register = async (username: string, email: string, password: string) => {
    try {
      const r = await fetch('/api/users/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, email, password }) })
      const data = await r.json()
      if (!r.ok) return false
      setUser(data.user); setToken(data.token); localStorage.setItem('token', data.token)
      return true
    } catch {
      return false
    }
  }

  const logout = () => { setUser(null); setToken(null); localStorage.removeItem('token') }

  const value = useMemo(() => ({ user, token, loading, login, register, logout }), [user, token, loading])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

