# Contributing

Thanks for your interest in contributing to `@codama/renderers-rust`.

## Getting set up

You'll need Node.js and pnpm (see `engines` and `packageManager` in
`package.json`). Then:

```sh
pnpm install
pnpm build
pnpm test
pnpm lint
```

## Declaring release intent

Any PR that ships a change to npm needs a changeset:

```sh
pnpm changeset
```

Pick the bump level (`patch` / `minor` / `major`), write a short user-facing
summary, and commit the resulting `.changeset/*.md` alongside your code.

## Releasing

Patch and minor releases are automated: merging a PR with a changeset into
`main` makes the release workflow open (or update) a release PR, and merging
that release PR publishes the package to npm.

Major releases follow the ecosystem-wide process described in the spec
repository's [RELEASING.md](https://github.com/codama-idl/spec/blob/HEAD/RELEASING.md)
(branch model, npm dist-tag conventions, release candidates, the bake window,
and the cross-repo release train).
