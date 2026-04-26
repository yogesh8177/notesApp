import { Suspense } from "react";
import SignInForm from "./sign-in-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Sign in — Notes" };

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Use your work email — magic link or password.</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={null}>
            <SignInForm />
          </Suspense>
        </CardContent>
      </Card>
    </main>
  );
}
