export interface NSSCTFCatalogBootstrapState {
  activeBank: string
  catalogTotal: number
  syncing: boolean
  attempted: boolean
}

export function shouldBootstrapNSSCTFCatalog(
  state: NSSCTFCatalogBootstrapState,
): boolean {
  return state.activeBank === 'nssctf'
    && state.catalogTotal === 0
    && !state.syncing
    && !state.attempted
}
