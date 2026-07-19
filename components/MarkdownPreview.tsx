"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { splitResumeSegments } from "@/lib/resume-format";

function JobHeader({
  company,
  title,
  dateRange,
}: {
  company: string;
  title: string;
  dateRange: string;
}) {
  return (
    <div className="not-prose mt-5 mb-1">
      <div className="flex justify-between items-baseline gap-4">
        <span className="font-bold text-indigo-300 text-base">{company}</span>
        <span className="text-gray-400 italic text-sm shrink-0">{dateRange}</span>
      </div>
      <p className="font-bold text-gray-200 text-sm mt-0.5 mb-1">{title}</p>
    </div>
  );
}

export default function MarkdownPreview({ content }: { content: string }) {
  const segments = splitResumeSegments(content);

  return (
    <div className="prose prose-invert prose-sm max-w-none">
      {segments.map((seg, i) =>
        seg.kind === "job" ? (
          <JobHeader key={i} company={seg.company} title={seg.title} dateRange={seg.dateRange} />
        ) : (
          <ReactMarkdown key={i} remarkPlugins={[remarkGfm]}>
            {seg.content}
          </ReactMarkdown>
        )
      )}
    </div>
  );
}
