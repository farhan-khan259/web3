import { ReactNode } from "react";
import UserAuthWrapper from "../../components/auth/UserAuthWrapper";

export default function UserLayout({ children }: { children: ReactNode }) {
  return <UserAuthWrapper>{children}</UserAuthWrapper>;
}
