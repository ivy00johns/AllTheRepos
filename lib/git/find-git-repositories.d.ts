declare module "find-git-repositories" {
  interface Options {
    throttleTimeoutMS?: number;
    maxSubfolderDeep?: number;
  }
  /**
   * Finds `.git` directories under `pathToSearch`.
   * The returned paths end in `/.git`.
   */
  function findGitRepos(
    pathToSearch: string,
    progressCallback?: (repositories: string[]) => boolean | void,
    options?: Options,
  ): Promise<string[]>;
  function findGitRepos(
    pathToSearch: string,
    options?: Options,
  ): Promise<string[]>;
  export default findGitRepos;
}
