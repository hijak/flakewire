import { Link, useLocation, useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { useEffect, useState } from "react";
import { getNotifications, NotificationItem } from "@/lib/api";

const Header = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    setLoading(true)
    getNotifications(false).then(d => setNotifications(d.notifications||[])).finally(()=> setLoading(false))
  }, [])
  
  const isActive = (path: string) => location.pathname === path;
  
  const navLinks = [
    { path: "/", label: "Home" },
    { path: "/movies", label: "Movies" },
    { path: "/tv-shows", label: "TV Shows" },
    { path: "/calendar", label: "Calendar" },
    { path: "/search", label: "Search" },
    { path: "/settings", label: "Settings" },
  ];

  return (
    <header className="sticky top-0 z-50 glass border-b border-border/50">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-3 hover-scale">
            <img src={'/logo.png'} alt="Flake Wire" className="h-8 w-8" style={{ backgroundColor: 'transparent' }} />
            <span className="text-xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
              Flake Wire
            </span>
          </Link>

          {/* Navigation */}
          <nav className="hidden md:flex items-center gap-6">
            {navLinks.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                className={`text-sm font-medium transition-all duration-300 relative ${
                  isActive(link.path)
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {link.label}
                {isActive(link.path) && (
                  <span className="absolute -bottom-1 left-0 w-full h-0.5 bg-primary rounded-full" />
                )}
              </Link>
            ))}
          </nav>

          {/* Right Actions */}
          <div className="flex items-center gap-3">
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="hidden md:flex relative">
                  <Bell className="h-5 w-5" />
                  {notifications.length > 0 && (
                    <span className="absolute -top-1 -right-1 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] h-4 min-w-4 px-1">
                      {notifications.length}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-96 p-0">
                <div className="p-3 border-b flex items-center justify-between">
                  <div className="text-sm font-semibold">Notifications</div>
                  <Button variant="glass" size="sm" onClick={()=>{ setLoading(true); getNotifications(true).then(d=> setNotifications(d.notifications||[])).finally(()=> setLoading(false)) }}>Refresh</Button>
                </div>
                <div className="max-h-80 overflow-auto">
                  {loading && (<div className="p-3 text-sm text-muted-foreground">Loading…</div>)}
                  {!loading && notifications.length === 0 && (
                    <div className="p-3 text-sm text-muted-foreground">No new notifications</div>
                  )}
                  <ul className="divide-y">
                    {notifications.map(n => (
                      <li key={n.id} className="p-3 hover:bg-muted/30 cursor-pointer" onClick={() => {
                        setOpen(false)
                        if (n.show?.imdbId) navigate(`/tv/${n.show.imdbId}/episodes`)
                      }}>
                        <div className="flex gap-3">
                          <img src={n.poster || '/logo.png'} alt="poster" className="h-12 w-8 object-cover rounded" />
                          <div className="flex-1">
                            <div className="text-xs text-muted-foreground">{n.title}</div>
                            <div className="text-sm font-medium">{n.message}</div>
                            {n.aired && (<div className="text-xs text-muted-foreground">{new Date(n.aired).toLocaleString()}</div>)}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
