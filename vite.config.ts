import { defineConfig } from "vite";

// Caminhos relativos para que o build estatico funcione tanto em uma URL interna
// quanto aberto a partir de um caminho de arquivo/hospedagem em subpasta.
// Porta fixa 8100 (o Projeto 5 usa 8000) e host aberto para acesso pela rede
// interna, no mesmo estilo de "abrir o servidor e testar pelo navegador".
export default defineConfig({
  base: "./",
  server: {
    host: true,
    port: 8100,
    strictPort: false,
    open: false,
  },
  preview: {
    host: true,
    port: 8100,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
  },
});
