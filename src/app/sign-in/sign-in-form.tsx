"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Mode = "magic" | "password";

export default function SignInForm() {
  const searchParams = useSearchParams();
  const redirectParam = searchParams.get("redirect_to");
  // Whitelist redirect_to: same-origin paths only. Magic-link redirects are an
  // open-redirect risk if we trust the param blindly.
  const redirectTo = redirectParam && redirectParam.startsWith("/") ? redirectParam : "/orgs";

  const [mode, setMode] = useState<Mode>("magic");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: "info" | "error"; text: string } | null>(null);

  const supabase = createClient();

  async function onMagic(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setMessage(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?redirect_to=${encodeURIComponent(redirectTo)}`,
      },
    });
    setPending(false);
    if (error) setMessage({ kind: "error", text: error.message });
    else setMessage({ kind: "info", text: "Check your email for the link." });
  }

  async function onPassword(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setMessage(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setPending(false);
    if (error) {
      setMessage({ kind: "error", text: error.message });
      return;
    }
    window.location.href = redirectTo;
  }

  return (
    <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)} className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="magic">Magic link</TabsTrigger>
        <TabsTrigger value="password">Password</TabsTrigger>
      </TabsList>
      <TabsContent value="magic">
        <form onSubmit={onMagic} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="email-magic">Email</Label>
            <Input
              id="email-magic"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Sending…" : "Send magic link"}
          </Button>
        </form>
      </TabsContent>
      <TabsContent value="password">
        <form onSubmit={onPassword} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="email-pw">Email</Label>
            <Input
              id="email-pw"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </TabsContent>
      {message && (
        <p
          className={`mt-3 text-sm ${
            message.kind === "error" ? "text-destructive" : "text-muted-foreground"
          }`}
        >
          {message.text}
        </p>
      )}
    </Tabs>
  );
}
