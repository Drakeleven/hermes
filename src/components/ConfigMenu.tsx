import { useState } from 'react';

export default function ConfigMenu({ config }: { config: any }) {
  if (!config) return null;
  return (
    <div className="mt-8 rounded-2xl border border-[#E4E8F5] bg-white p-6 shadow-sm">
      <h2 className="text-[16px] font-bold text-[#1F2340]">Pengaturan App</h2>
      <pre className="mt-4 overflow-auto rounded-lg bg-gray-50 p-4 text-xs">
        {JSON.stringify(config, null, 2)}
      </pre>
    </div>
  );
}
