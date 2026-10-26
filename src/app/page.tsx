import { RawInputForm } from "@/components/raw-input-form";

export default function HomePage() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">New product</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Paste the raw attributes you got from the supplier. Save the product, then
          generate its copy on the product page.
        </p>
      </div>
      <RawInputForm />
    </div>
  );
}
