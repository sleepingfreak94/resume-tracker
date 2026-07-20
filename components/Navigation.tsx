"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/jobs", label: "Jobs" },
  { href: "/scan", label: "Scan" },
  { href: "/add", label: "Add Job" },
  { href: "/resume", label: "Resume" },
  { href: "/rules", label: "Rules" },
  { href: "/profile", label: "Profile" },
];

export default function Navigation() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#080a0f]/85 backdrop-blur-xl">
      <div className="max-w-[90rem] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-[4.5rem]">
          <Link href="/" className="flex items-center gap-3 group" aria-label="Resume Tracker dashboard">
            <span className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[0.05] text-[10px] font-black tracking-tight text-[#c7f36b] transition-colors group-hover:border-[#c7f36b]/30">
              RT
            </span>
            <span className="grid leading-none">
              <span className="text-sm font-semibold tracking-[-0.02em] text-white">Resume Tracker</span>
              <span className="mt-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-gray-600">Job search workspace</span>
            </span>
          </Link>

          <div className="hidden lg:flex items-center gap-0.5 rounded-xl border border-white/[0.06] bg-white/[0.025] p-1">
            {links.map((link) => {
              const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={`px-3 py-2 rounded-lg text-[11px] font-semibold transition-all ${
                    active
                      ? "bg-[#f2f3ef] text-[#111318] shadow-sm"
                      : "text-gray-500 hover:text-gray-200 hover:bg-white/[0.04]"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>

          <button
            type="button"
            aria-label={open ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={open}
            aria-controls="mobile-navigation"
            onClick={() => setOpen((value) => !value)}
            className="lg:hidden inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] text-gray-300 hover:bg-white/[0.05] hover:text-white"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={open ? "M6 18L18 6M6 6l12 12" : "M4 6h16M4 12h16M4 18h16"} />
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <div id="mobile-navigation" className="lg:hidden border-t border-white/[0.06] px-4 py-3 grid gap-1 bg-[#0d1016] shadow-2xl">
          {links.map((link) => {
            const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                aria-current={active ? "page" : undefined}
                className={`px-3 py-2.5 rounded-lg text-sm font-medium ${
                  active
                    ? "bg-[#f2f3ef] text-[#111318]"
                    : "text-gray-400 hover:bg-white/[0.05] hover:text-white"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      )}
    </nav>
  );
}
