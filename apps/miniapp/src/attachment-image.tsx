import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { fetchAttachment } from './api';

export function AttachmentImage({
  url,
  name,
  lazy = false,
}: {
  url: string;
  name: string;
  lazy?: boolean;
}) {
  const query = useQuery({
    queryKey: ['attachment-image', url],
    queryFn: () => fetchAttachment(url),
    staleTime: 5 * 60_000,
  });
  const [source, setSource] = useState<string | null>(null);
  useEffect(() => {
    if (!query.data) return;
    const objectUrl = URL.createObjectURL(query.data);
    setSource(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [query.data]);
  if (query.isError) return <span role="alert">Не удалось загрузить фото</span>;
  return source ? (
    <img src={source} alt={name} loading={lazy ? 'lazy' : 'eager'} />
  ) : (
    <span role="status">Загружаем фото…</span>
  );
}
