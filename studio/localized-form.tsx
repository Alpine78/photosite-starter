import { useCurrentLocale, type FieldProps, type InputProps } from "sanity";
import { studioInterfaceText } from "./interface-locales";

export function LocalizedField(props: FieldProps) {
  const { id } = useCurrentLocale();
  return props.renderDefault({
    ...props,
    title: studioInterfaceText(props.title, id),
    description: studioInterfaceText(props.description, id),
  });
}

/** Translate option labels; accepted values and change handlers remain untouched. */
export function LocalizedInput(props: InputProps) {
  const { id } = useCurrentLocale();
  if (!/^fi(?:-|$)/.test(id)) return props.renderDefault(props);
  const options = props.schemaType.options;
  const list = options && "list" in options && Array.isArray(options.list) ? options.list.map((option: unknown) => {
    if (typeof option !== "object" || option === null || !("title" in option) || typeof option.title !== "string") return option;
    return { ...option, title: studioInterfaceText(option.title, id) };
  }) : undefined;
  const type = props.schemaType;
  const titles = (members: readonly { title?: string }[]) => members.map((member) => ({
    ...member, title: studioInterfaceText(member.title, id),
  }));
  return props.renderDefault({ ...props, schemaType: {
    ...type,
    title: studioInterfaceText(type.title, id),
    ...(list ? { options: { ...options, list } } : {}),
    ...("of" in type && Array.isArray(type.of) ? { of: titles(type.of) } : {}),
    ...("to" in type && Array.isArray(type.to) ? { to: titles(type.to) } : {}),
  } } as InputProps);
}
