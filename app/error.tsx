"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="mx-auto max-w-lg rounded-2xl border border-red-900 bg-red-950/30 p-8 text-center"><h1 className="text-xl font-semibold text-white">Something went wrong</h1><p className="mt-2 text-sm text-gray-300">The page could not be loaded. Your saved data has not been changed.</p><button type="button" onClick={reset} className="mt-5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white">Try again</button></div>;
}
