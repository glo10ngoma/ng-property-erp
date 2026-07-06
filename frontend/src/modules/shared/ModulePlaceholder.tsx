import { PageHeader } from '../../core/layout/PageHeader';
import { EmptyState } from '../../core/components/EmptyState';

export function ModulePlaceholder({ title }: { title: string }) {
  return (
    <section>
      <PageHeader title={title} />
      <EmptyState message="Module prêt à être connecté aux données métier." />
    </section>
  );
}
