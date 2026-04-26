import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { createOrg } from "@/lib/orgs";

export const metadata = { title: "New Organisation" };

export default async function NewOrgPage() {
  await requireUser("/orgs/new");

  async function handleCreate(formData: FormData) {
    "use server";
    const result = await createOrg({
      name: String(formData.get("name") ?? ""),
      slug: String(formData.get("slug") ?? ""),
    });
    if (result.ok) {
      redirect(`/orgs/${result.data.id}/notes`);
    }
  }

  return (
    <main className="mx-auto max-w-md py-16 px-4">
      <h1 className="text-2xl font-semibold mb-6">Create a new organisation</h1>
      <form action={handleCreate} className="space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium mb-1">
            Name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            minLength={2}
            maxLength={80}
            placeholder="Acme Corp"
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="slug" className="block text-sm font-medium mb-1">
            Slug
            <span className="text-muted-foreground font-normal ml-1">(URL-safe, e.g. acme-corp)</span>
          </label>
          <input
            id="slug"
            name="slug"
            type="text"
            required
            minLength={2}
            maxLength={40}
            pattern="[a-z0-9-]+"
            placeholder="acme-corp"
            className="w-full border rounded px-3 py-2 text-sm font-mono"
          />
          <p className="text-xs text-muted-foreground mt-1">Lowercase letters, numbers, hyphens only.</p>
        </div>
        <button
          type="submit"
          className="w-full bg-primary text-primary-foreground rounded py-2 text-sm font-medium hover:opacity-90"
        >
          Create organisation
        </button>
      </form>
    </main>
  );
}
