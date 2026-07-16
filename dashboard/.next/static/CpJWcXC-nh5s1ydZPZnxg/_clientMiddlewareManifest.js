self.__MIDDLEWARE_MATCHERS = [
  {
    "regexp": "^\\/dashboard(?:\\/(_next\\/data\\/[^/]{1,}))?(?:\\/((?!api|assets|_next\\/static|_next\\/image|favicon.ico|.*\\..*).*))(\\.json|\\.rsc|\\.segments\\/.+\\.segment\\.rsc)?[\\/#\\?]?$",
    "originalSource": "/((?!api|assets|_next/static|_next/image|favicon.ico|.*\\..*).*)"
  }
];self.__MIDDLEWARE_MATCHERS_CB && self.__MIDDLEWARE_MATCHERS_CB()