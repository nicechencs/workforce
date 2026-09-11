import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

export interface PageChrome {
  title: string;
  subtitle?: string;
}

const PageChromeValueContext = createContext<PageChrome | null>(null);
const PageChromeSetterContext = createContext<Dispatch<SetStateAction<PageChrome | null>> | null>(
  null,
);

export function PageChromeProvider(props: { children: ReactNode }): ReactNode {
  const [chrome, setChrome] = useState<PageChrome | null>(null);
  return (
    <PageChromeSetterContext.Provider value={setChrome}>
      <PageChromeValueContext.Provider value={chrome}>
        {props.children}
      </PageChromeValueContext.Provider>
    </PageChromeSetterContext.Provider>
  );
}

export function usePageChrome(): PageChrome | null {
  return useContext(PageChromeValueContext);
}

/** 在应用壳内把页标题抬到顶栏；无 Provider 时返回 false，页面自己渲染标题。 */
export function useLiftPageChrome(title: string, subtitle?: string | undefined): boolean {
  const setChrome = useContext(PageChromeSetterContext);
  const next = useMemo<PageChrome>(
    () => (subtitle === undefined ? { title } : { title, subtitle }),
    [title, subtitle],
  );

  useEffect(() => {
    if (!setChrome) {
      return;
    }
    setChrome(next);
    return () => {
      setChrome(null);
    };
  }, [next, setChrome]);

  return setChrome !== null;
}
