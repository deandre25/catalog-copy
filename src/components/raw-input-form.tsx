"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type FieldErrors = Partial<Record<"title" | "rawInput", string[]>>;

export function RawInputForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFieldErrors({});
    setFormError(null);

    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: form.get("title"),
          rawInput: form.get("rawInput"),
        }),
      });

      if (response.status === 201) {
        const { id } = (await response.json()) as { id: string };
        router.push(`/products/${id}`);
        return;
      }

      if (response.status === 400) {
        const { fieldErrors, formErrors } = (await response.json()) as {
          fieldErrors: FieldErrors;
          formErrors: string[];
        };
        setFieldErrors(fieldErrors);
        if (formErrors.length > 0) setFormError(formErrors[0]);
        return;
      }

      setFormError("Something went wrong on the server. Try again.");
    } catch {
      setFormError("Could not reach the server. Check your connection.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="space-y-2">
        <label htmlFor="title" className="block text-sm font-medium">
          Product name
        </label>
        <input
          id="title"
          name="title"
          placeholder="Bosch WAN28281 washing machine"
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-300"
        />
        <FieldError messages={fieldErrors.title} />
      </div>

      <div className="space-y-2">
        <label htmlFor="rawInput" className="block text-sm font-medium">
          Raw specs
        </label>
        <textarea
          id="rawInput"
          name="rawInput"
          rows={12}
          placeholder={"Load: 7 kg\nSpin: 1400 rpm\nEnergy class: A+++\nDepth: 55 cm\nDisplay: LED"}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-300"
        />
        <FieldError messages={fieldErrors.rawInput} />
      </div>

      {formError ? <p className="text-sm text-red-600 dark:text-red-400">{formError}</p> : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {pending ? "Saving…" : "Save product"}
      </button>
    </form>
  );
}

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return <p className="text-sm text-red-600 dark:text-red-400">{messages[0]}</p>;
}
