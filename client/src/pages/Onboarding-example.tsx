import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Check, Copy, Key, Tv, HardDrive, Film, Image, ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import logo from "@/assets/logo.png";

const Onboarding = () => {
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  // Trakt state
  const [traktCode, setTraktCode] = useState("");
  const [traktVerified, setTraktVerified] = useState(false);

  // All Debrid state
  const [allDebridCode, setAllDebridCode] = useState("");
  const [allDebridVerified, setAllDebridVerified] = useState(false);

  // API Keys state
  const [omdbKey, setOmdbKey] = useState("");
  const [fanartKey, setFanartKey] = useState("");

  const generateTraktCode = () => {
    setIsLoading(true);
    // Simulate API call to get device code
    setTimeout(() => {
      setTraktCode("ABCD-EFGH");
      setIsLoading(false);
      toast({
        title: "Device code generated",
        description: "Visit trakt.tv/activate to enter your code",
      });
    }, 1000);
  };

  const verifyTraktCode = () => {
    setIsLoading(true);
    // Simulate verification
    setTimeout(() => {
      setTraktVerified(true);
      setIsLoading(false);
      toast({
        title: "Trakt connected!",
        description: "Successfully connected to your Trakt account",
      });
    }, 1500);
  };

  const generateAllDebridCode = () => {
    setIsLoading(true);
    // Simulate API call to get device code
    setTimeout(() => {
      setAllDebridCode("WXYZ-1234");
      setIsLoading(false);
      toast({
        title: "Device code generated",
        description: "Visit alldebrid.com/pin to enter your code",
      });
    }, 1000);
  };

  const verifyAllDebridCode = () => {
    setIsLoading(true);
    // Simulate verification
    setTimeout(() => {
      setAllDebridVerified(true);
      setIsLoading(false);
      toast({
        title: "All Debrid connected!",
        description: "Successfully connected to your All Debrid account",
      });
    }, 1500);
  };

  const handleFinish = () => {
    setIsLoading(true);
    // Save all settings
    setTimeout(() => {
      setIsLoading(false);
      toast({
        title: "Setup complete!",
        description: "Your Flake Wire is ready to use",
      });
      navigate("/");
    }, 1000);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied!",
      description: "Code copied to clipboard",
    });
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
          <img src={logo} alt="Flake Wire" className="h-12 w-12" />
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
                s === step
                  ? "bg-primary"
                  : s < step
                  ? "bg-primary/60"
                  : "bg-border"
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
                  {traktVerified && <Check className="h-6 w-6 text-success" />}
                </div>

                {!traktCode && (
                  <Button
                    variant="hero"
                    className="w-full"
                    onClick={generateTraktCode}
                    disabled={isLoading}
                  >
                    {isLoading ? "Generating..." : "Generate Device Code"}
                  </Button>
                )}

                {traktCode && !traktVerified && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Your Device Code</Label>
                      <div className="flex gap-2">
                        <Input
                          value={traktCode}
                          readOnly
                          className="font-mono text-lg text-center tracking-wider"
                        />
                        <Button
                          variant="glass"
                          size="icon"
                          onClick={() => copyToClipboard(traktCode)}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="p-4 rounded-lg bg-muted/50 border border-border">
                      <p className="text-sm">
                        1. Visit <span className="font-mono text-primary">trakt.tv/activate</span>
                        <br />
                        2. Enter the code above
                        <br />
                        3. Click "Verify Connection" below
                      </p>
                    </div>

                    <Button
                      variant="hero"
                      className="w-full"
                      onClick={verifyTraktCode}
                      disabled={isLoading}
                    >
                      {isLoading ? "Verifying..." : "Verify Connection"}
                    </Button>
                  </div>
                )}

                {traktVerified && (
                  <Button
                    variant="hero"
                    className="w-full gap-2"
                    onClick={() => setStep(2)}
                  >
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
                  {allDebridVerified && <Check className="h-6 w-6 text-success" />}
                </div>

                {!allDebridCode && (
                  <Button
                    variant="hero"
                    className="w-full"
                    onClick={generateAllDebridCode}
                    disabled={isLoading}
                  >
                    {isLoading ? "Generating..." : "Generate Device Code"}
                  </Button>
                )}

                {allDebridCode && !allDebridVerified && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Your Device Code</Label>
                      <div className="flex gap-2">
                        <Input
                          value={allDebridCode}
                          readOnly
                          className="font-mono text-lg text-center tracking-wider"
                        />
                        <Button
                          variant="glass"
                          size="icon"
                          onClick={() => copyToClipboard(allDebridCode)}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="p-4 rounded-lg bg-muted/50 border border-border">
                      <p className="text-sm">
                        1. Visit <span className="font-mono text-primary">alldebrid.com/pin</span>
                        <br />
                        2. Enter the code above
                        <br />
                        3. Click "Verify Connection" below
                      </p>
                    </div>

                    <Button
                      variant="hero"
                      className="w-full"
                      onClick={verifyAllDebridCode}
                      disabled={isLoading}
                    >
                      {isLoading ? "Verifying..." : "Verify Connection"}
                    </Button>
                  </div>
                )}

                {allDebridVerified && (
                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => setStep(1)}
                    >
                      <ArrowLeft className="h-4 w-4 mr-2" />
                      Back
                    </Button>
                    <Button
                      variant="hero"
                      className="flex-1 gap-2"
                      onClick={() => setStep(3)}
                    >
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
                      <Label htmlFor="omdb-key">OMDB API Key</Label>
                    </div>
                    <Input
                      id="omdb-key"
                      type="text"
                      placeholder="Enter your OMDB API key"
                      value={omdbKey}
                      onChange={(e) => setOmdbKey(e.target.value)}
                      className="font-mono"
                    />
                    <p className="text-xs text-muted-foreground">
                      Get your free API key from <span className="text-primary">omdbapi.com</span>
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2 mb-2">
                      <Image className="h-5 w-5 text-primary" />
                      <Label htmlFor="fanart-key">Fanart.tv API Key</Label>
                    </div>
                    <Input
                      id="fanart-key"
                      type="text"
                      placeholder="Enter your Fanart.tv API key"
                      value={fanartKey}
                      onChange={(e) => setFanartKey(e.target.value)}
                      className="font-mono"
                    />
                    <p className="text-xs text-muted-foreground">
                      Get your API key from <span className="text-primary">fanart.tv</span>
                    </p>
                  </div>
                </div>

                <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
                  <div className="flex items-start gap-2">
                    <Key className="h-5 w-5 text-primary mt-0.5" />
                    <div className="text-sm">
                      <p className="font-medium mb-1">Secure Storage</p>
                      <p className="text-muted-foreground">
                        Your API keys are stored securely and never shared with third parties.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setStep(2)}
                  >
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back
                  </Button>
                  <Button
                    variant="hero"
                    className="flex-1 gap-2"
                    onClick={handleFinish}
                    disabled={isLoading || !omdbKey || !fanartKey}
                  >
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
