import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Check, Copy, Key, Tv, HardDrive, Film, Image, ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

type OAuthStatus = { configured: boolean; expired: boolean };

const Onboarding = () => {
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  // Status
  const [traktStatus, setTraktStatus] = useState<OAuthStatus>({ configured: false, expired: false });
  const [alldebridStatus, setAlldebridStatus] = useState<OAuthStatus>({ configured: false, expired: false });
  const [omdbConfigured, setOmdbConfigured] = useState<"env" | "storage" | "none">("none");
  const [fanartConfigured, setFanartConfigured] = useState<"env" | "storage" | "none">("none");

  // Trakt device flow
  const [traktCode, setTraktCode] = useState("");
  const [traktVerifyUrl, setTraktVerifyUrl] = useState("");
  const [traktDeviceCode, setTraktDeviceCode] = useState("");
  const [traktVerified, setTraktVerified] = useState(false);
  const traktPollRef = useRef<number | null>(null);
  const traktPollEndRef = useRef<number>(0);

  // AllDebrid PIN flow
  const [allDebridCode, setAllDebridCode] = useState("");
  const [allDebridVerified, setAllDebridVerified] = useState(false);
  const [adCheckToken, setAdCheckToken] = useState("");
  const [adUserUrl, setAdUserUrl] = useState("");

  // API Keys state
  const [omdbKey, setOmdbKey] = useState("");
  const [fanartKey, setFanartKey] = useState("");

  const loadStatus = async () => {
    try {
      const [t, a, omdb, fan] = await Promise.all([
        fetch("/api/auth/oauth/trakt/status").then((r) => (r.ok ? r.json() : { configured: false, expired: false })),
        fetch("/api/auth/oauth/alldebrid/status").then((r) => (r.ok ? r.json() : { configured: false, expired: false })),
        fetch("/api/public/api-keys/omdb"),
        fetch("/api/public/api-keys/fanarttv"),
      ]);
      setTraktStatus(t);
      setAllDebridStatus(a);
      setTraktVerified(Boolean(t?.configured));
      setAllDebridVerified(Boolean(a?.configured));
      setOmdbConfigured(omdb.ok ? ((await omdb.json()).source === "env" ? "env" : "storage") : "none");
      setFanartConfigured(fan.ok ? ((await fan.json()).source === "env" ? "env" : "storage") : "none");
      // Advance to next step if prior already configured
      if (t?.configured) setStep(2);
      if (t?.configured && a?.configured) setStep(3);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadStatus();
    return () => {
      if (traktPollRef.current) window.clearInterval(traktPollRef.current);
    };
  }, []);

  const startTrakt = async () => {
    setIsLoading(true);
    try {
      const r = await fetch("/api/auth/oauth/trakt/device/start", { method: "POST" });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || "Failed to start device auth");
      setTraktCode(data.user_code || "");
      setTraktVerifyUrl(data.verification_url || "");
      setTraktDeviceCode(data.device_code || "");
      try { await navigator.clipboard.writeText(data.user_code || ""); } catch {}
      if (data.verification_url && data.user_code) {
        window.open(`${data.verification_url}?code=${encodeURIComponent(data.user_code)}`, "_blank");
      }
      // start polling
      const expires = Date.now() + (Number(data.expires_in || 600) * 1000);
      traktPollEndRef.current = expires;
      if (traktPollRef.current) window.clearInterval(traktPollRef.current);
      traktPollRef.current = window.setInterval(async () => {
        if (Date.now() > traktPollEndRef.current) {
          window.clearInterval(traktPollRef.current!);
          traktPollRef.current = null;
          setIsLoading(false);
          toast({ title: "Trakt authorization timed out", description: "Please generate a new code" });
          return;
        }
        try {
          const p = await fetch("/api/auth/oauth/trakt/device/poll", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ device_code: data.device_code }),
          });
          const j = await p.json();
          if (j && j.success) {
            window.clearInterval(traktPollRef.current!);
            traktPollRef.current = null;
            setTraktVerified(true);
            toast({ title: "Trakt connected!", description: "Your Trakt account is linked" });
            await loadStatus();
          }
        } catch {
          // ignore retry
        }
      }, Number(data.interval || 5) * 1000);
    } catch (e: any) {
      toast({ title: "Trakt error", description: e?.message || "Failed to start device auth" });
    } finally {
      setIsLoading(false);
    }
  };

  const generateAllDebridCode = async () => {
    setIsLoading(true);
    try {
      const r = await fetch("/api/auth/oauth/alldebrid/auth");
      const d = await r.json();
      if (!r.ok || !d?.pinData) throw new Error(d?.error || "Failed to get PIN");
      setAllDebridCode(d.pinData.pin);
      setAdCheckToken(d.pinData.check);
      setAdUserUrl(d.pinData.user_url);
      try { await navigator.clipboard.writeText(d.pinData.pin); } catch {}
      if (d.pinData.user_url && d.pinData.pin) {
        window.open(`${d.pinData.user_url}?pin=${encodeURIComponent(d.pinData.pin)}`, "_blank");
      }
      // begin polling
      const start = Date.now();
      const poll = async () => {
        try {
          const pr = await fetch("/api/auth/oauth/alldebrid/check", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pin: d.pinData.pin, check: d.pinData.check }),
          });
          const pj = await pr.json();
          if (pj?.activated) {
            setAllDebridVerified(true);
            toast({ title: "AllDebrid connected!", description: "Your AllDebrid account is linked" });
            await loadStatus();
            return;
          }
        } catch {
          // ignore
        }
        if (Date.now() - start < 120000) setTimeout(poll, 3000);
      };
      setTimeout(poll, 3000);
    } catch (e: any) {
      toast({ title: "AllDebrid error", description: e?.message || "Failed to get PIN" });
    } finally {
      setIsLoading(false);
    }
  };

  const verifyAllDebridCode = async () => {
    if (!allDebridCode || !adCheckToken) return;
    setIsLoading(true);
    try {
      const pr = await fetch("/api/auth/oauth/alldebrid/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: allDebridCode, check: adCheckToken }),
      });
      const pj = await pr.json();
      if (pj?.activated) {
        setAllDebridVerified(true);
        toast({ title: "AllDebrid connected!", description: "Your AllDebrid account is linked" });
        await loadStatus();
      } else {
        toast({ title: "Not activated yet", description: "Please approve in AllDebrid and try again" });
      }
    } catch (e: any) {
      toast({ title: "AllDebrid error", description: e?.message || "Verification failed" });
    } finally {
      setIsLoading(false);
    }
  };

  const verifyTraktCode = async () => {
    if (!traktDeviceCode) return;
    setIsLoading(true);
    try {
      const p = await fetch("/api/auth/oauth/trakt/device/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_code: traktDeviceCode }),
      });
      const j = await p.json();
      if (j && j.success) {
        setTraktVerified(true);
        toast({ title: "Trakt connected!", description: "Your Trakt account is linked" });
        await loadStatus();
      } else {
        toast({ title: "Not authorized yet", description: "Please approve in Trakt and try again" });
      }
    } catch (e: any) {
      toast({ title: "Trakt error", description: e?.message || "Verification failed" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleFinish = async () => {
    setIsLoading(true);
    try {
      // Save API keys in default scope (single-user mode)
      const headers: any = { "Content-Type": "application/json" };
      if (omdbKey) await fetch("/api/public/api-keys/omdb", { method: "POST", headers, body: JSON.stringify({ apiKey: omdbKey }) });
      if (fanartKey) await fetch("/api/public/api-keys/fanarttv", { method: "POST", headers, body: JSON.stringify({ apiKey: fanartKey }) });
      try { localStorage.setItem("onboardingComplete", "true"); } catch {}
      toast({ title: "Setup complete!", description: "Your Flake Wire is ready" });
      navigate("/");
    } catch {
      toast({ title: "Save failed", description: "Could not save API keys" });
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    try { navigator.clipboard.writeText(text); } catch {}
    toast({ title: "Copied!", description: "Code copied to clipboard" });
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-background" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,hsl(194_100%_56%_/_0.1),transparent)]" />

      <div className="w-full max-w-2xl relative z-10 animate-fade-in-up">
        {/* Back to home */}
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-8 transition-colors">
          <ArrowLeft className="h-4 w-4" />
          Back to Home
        </Link>

        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <img src={'/logo.png'} alt="Flake Wire" className="h-12 w-12" />
          <span className="text-3xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
            Flake Wire Setup
          </span>
        </div>

        {/* Progress indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`h-2 w-20 rounded-full transition-all duration-300 ${
                s === step ? "bg-primary" : s < step ? "bg-primary/60" : "bg-border"
              }`}
            />
          ))}
        </div>

        <Card className="glass border-border/50 shadow-[var(--shadow-elegant)]">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl font-bold">
              {step === 1 && "Connect to Trakt"}
              {step === 2 && "Connect to All Debrid"}
              {step === 3 && "API Configuration"}
            </CardTitle>
            <CardDescription>
              {step === 1 && "Link your Trakt account to track your shows"}
              {step === 2 && "Link your All Debrid account for premium streaming"}
              {step === 3 && "Enter your API keys for enhanced features"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Step 1: Trakt */}
            {step === 1 && (
              <div className="space-y-6">
                <div className="flex items-center gap-3 p-4 rounded-lg bg-primary/5 border border-primary/20">
                  <Tv className="h-6 w-6 text-primary" />
                  <div className="flex-1">
                    <p className="font-medium">Trakt Device Authentication</p>
                    <p className="text-sm text-muted-foreground">Track your TV shows and movies</p>
                  </div>
                  {(traktVerified || traktStatus.configured) && <Check className="h-6 w-6 text-success" />}
                </div>

                {!traktCode && !traktVerified && !traktStatus.configured && (
                  <Button variant="hero" className="w-full" onClick={startTrakt} disabled={isLoading}>
                    {isLoading ? "Generating..." : "Generate Device Code"}
                  </Button>
                )}

                {(traktCode || traktVerified || traktStatus.configured) && !traktVerified && !traktStatus.configured && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Your Device Code</Label>
                      <div className="flex gap-2">
                        <Input value={traktCode} readOnly className="font-mono text-lg text-center tracking-wider" />
                        <Button variant="glass" size="icon" onClick={() => copyToClipboard(traktCode)}>
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="p-4 rounded-lg bg-muted/50 border border-border">
                      <p className="text-sm">
                        1. Visit <span className="font-mono text-primary">{traktVerifyUrl || "trakt.tv/activate"}</span>
                        <br />
                        2. Enter the code above
                        <br />
                        3. Click "Verify Connection" below
                      </p>
                    </div>
                    <Button variant="hero" className="w-full" onClick={verifyTraktCode} disabled={isLoading}>
                      {isLoading ? "Verifying..." : "Verify Connection"}
                    </Button>
                  </div>
                )}

                {(traktVerified || traktStatus.configured) && (
                  <Button variant="hero" className="w-full gap-2" onClick={() => setStep(2)}>
                    Next Step
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                )}
              </div>
            )}

            {/* Step 2: All Debrid */}
            {step === 2 && (
              <div className="space-y-6">
                <div className="flex items-center gap-3 p-4 rounded-lg bg-primary/5 border border-primary/20">
                  <HardDrive className="h-6 w-6 text-primary" />
                  <div className="flex-1">
                    <p className="font-medium">All Debrid Device Authentication</p>
                    <p className="text-sm text-muted-foreground">Premium streaming service</p>
                  </div>
                  {(allDebridVerified || alldebridStatus.configured) && <Check className="h-6 w-6 text-success" />}
                </div>

                {!allDebridCode && !allDebridVerified && !alldebridStatus.configured && (
                  <Button variant="hero" className="w-full" onClick={generateAllDebridCode} disabled={isLoading}>
                    {isLoading ? "Generating..." : "Generate Device Code"}
                  </Button>
                )}

                {(allDebridCode || allDebridVerified || alldebridStatus.configured) && !allDebridVerified && !alldebridStatus.configured && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Your Device Code</Label>
                      <div className="flex gap-2">
                        <Input value={allDebridCode} readOnly className="font-mono text-lg text-center tracking-wider" />
                        <Button variant="glass" size="icon" onClick={() => copyToClipboard(allDebridCode)}>
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="p-4 rounded-lg bg-muted/50 border border-border">
                      <p className="text-sm">
                        1. Visit <span className="font-mono text-primary">{adUserUrl || "alldebrid.com/pin"}</span>
                        <br />
                        2. Enter the code above
                        <br />
                        3. Click "Verify Connection" below
                      </p>
                    </div>
                    <Button variant="hero" className="w-full" onClick={verifyAllDebridCode} disabled={isLoading}>
                      {isLoading ? "Verifying..." : "Verify Connection"}
                    </Button>
                  </div>
                )}

                {(allDebridVerified || alldebridStatus.configured) && (
                  <div className="flex gap-3">
                    <Button variant="outline" className="flex-1" onClick={() => setStep(1)}>
                      <ArrowLeft className="h-4 w-4 mr-2" />
                      Back
                    </Button>
                    <Button variant="hero" className="flex-1 gap-2" onClick={() => setStep(3)}>
                      Next Step
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Step 3: API Keys */}
            {step === 3 && (
              <div className="space-y-6">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 mb-2">
                      <Film className="h-5 w-5 text-primary" />
                      <Label htmlFor="omdb-key">OMDB API Key {omdbConfigured !== "none" && <span className="text-xs text-success">({omdbConfigured})</span>}</Label>
                    </div>
                    <Input id="omdb-key" type="text" placeholder="Enter your OMDB API key" value={omdbKey} onChange={(e) => setOmdbKey(e.target.value)} className="font-mono" />
                    <p className="text-xs text-muted-foreground">Get your free API key from <span className="text-primary">omdbapi.com</span></p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2 mb-2">
                      <Image className="h-5 w-5 text-primary" />
                      <Label htmlFor="fanart-key">Fanart.tv API Key {fanartConfigured !== "none" && <span className="text-xs text-success">({fanartConfigured})</span>}</Label>
                    </div>
                    <Input id="fanart-key" type="text" placeholder="Enter your Fanart.tv API key" value={fanartKey} onChange={(e) => setFanartKey(e.target.value)} className="font-mono" />
                    <p className="text-xs text-muted-foreground">Get your API key from <span className="text-primary">fanart.tv</span></p>
                  </div>
                </div>

                <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
                  <div className="flex items-start gap-2">
                    <Key className="h-5 w-5 text-primary mt-0.5" />
                    <div className="text-sm">
                      <p className="font-medium mb-1">Secure Storage</p>
                      <p className="text-muted-foreground">Your API keys are stored securely and never shared with third parties.</p>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <Button variant="outline" className="flex-1" onClick={() => setStep(2)}>
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back
                  </Button>
                  <Button variant="hero" className="flex-1 gap-2" onClick={handleFinish} disabled={isLoading}>
                    {isLoading ? "Saving..." : "Complete Setup"}
                    <Check className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Onboarding;
