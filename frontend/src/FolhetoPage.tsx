/** Exibe o folheto estático (public/folheto/index.html) em tela cheia. */
export function FolhetoPage() {
  return (
    <iframe
      title="Folheto CondoLM"
      src="/folheto/index.html"
      style={{
        display: 'block',
        width: '100%',
        height: '100vh',
        border: 'none',
      }}
    />
  );
}
