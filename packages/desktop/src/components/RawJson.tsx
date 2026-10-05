export function RawJson({ value }: { value: unknown }) {
  return (
    <section className="panel">
      <h2>调用结果</h2>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </section>
  );
}
