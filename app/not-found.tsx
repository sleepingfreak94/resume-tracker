import Link from "next/link";

export default function NotFound() {
  return <div className="mx-auto max-w-lg py-20 text-center"><h1 className="text-2xl font-bold text-white">Page not found</h1><p className="mt-2 text-gray-400">That page or job no longer exists.</p><Link href="/jobs" className="mt-5 inline-flex rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white">Back to jobs</Link></div>;
}
