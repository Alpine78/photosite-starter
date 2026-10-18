/** A saved chapter never outranks deliberate navigation or an already visible place. */
export function mayRestoreReadingPosition(input: {
  readonly initialHref: string;
  readonly currentHref: string;
  readonly hasFragment: boolean;
  readonly historyDestination?: string;
  readonly initialDocumentHref: string;
  readonly initialNavigationType?: string;
  readonly freshLinkDestination?: string;
  readonly interacted: boolean;
  readonly scrollY: number;
  readonly modalOpen: boolean;
  readonly visible: boolean;
}): boolean {
  return input.initialHref === input.currentHref && !input.hasFragment &&
    input.historyDestination !== input.currentHref &&
    !(input.initialDocumentHref === input.currentHref &&
      input.freshLinkDestination !== input.currentHref &&
      input.initialNavigationType !== "navigate" && input.initialNavigationType !== "reload") &&
    !input.interacted && input.scrollY === 0 && !input.modalOpen && input.visible;
}
