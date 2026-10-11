/* CodeTrain — the in-lesson glossary. Classic script, window.CTGlossary.

   GENERATED FILE. `control-plane/scripts/gen_glossary.py` writes it from
   `control-plane/app/services/glossary_terms.py`; `test_glossary.py` fails when it is stale, and
   fails again if this file and `engine/app/static/glossary.js` are not byte-identical. Copy one
   over the other, never hand-merge: the agent runs the same lessons in a real browser off
   loopback, so it renders the same definitions.

   WHAT THIS DOES. A learner reads "use dot notation to read the property" and has no way to ask
   what that means without leaving the step. `linkTerms(el, lang)` walks the TEXT NODES under a
   container and turns the first mention of each known term into a button; pressing it opens a
   small popover with the definition. No network call, no model call, no CSP change: the data is
   in this file.

   WHY TEXT NODES AND NOT A STRING REWRITE. The prose arrives as HTML that `md()` has already
   built, and a regex over that string would match inside a tag name, an attribute or a URL. A
   walk over text nodes cannot reach any of those, so the class of bug does not exist here.

   THE RULES, each preventing something specific:
     - never inside <pre>, <code class="no-link">, a link, or a button. A learner's own code and
       the tutor's examples are left exactly as written.
     - a `code_only` term links only inside an inline <code>. Its surface form is an ordinary
       English word, and CodeTrain's own rail map calls a group of lessons a "class".
     - one link per term per container. A popup on every third word is a page people stop reading.
     - only terms whose langs include this step's runtime, or "*". A Python learner is never
       handed a definition written about JavaScript.

   Everything rendered here is set with textContent. Nothing in this file concatenates a term's
   own text into markup. */
"use strict";

(function () {
  const TERMS = {
    "variable": {
      "term": "variable",
      "langs": [
        "*"
      ],
      "short": "A name you attach to a value so you can use it again later.",
      "body": "Naming a value lets the rest of the program refer to it without repeating it, and lets you change it in one place. The name is not the value: two names can point at the same thing.",
      "example": "greeting = \"hello\"",
      "see_also": [
        "assignment",
        "scope"
      ]
    },
    "assignment": {
      "term": "assignment",
      "langs": [
        "*"
      ],
      "short": "Putting a value into a name, using a single equals sign.",
      "body": "One equals sign stores. Two compare. That difference causes more early bugs than any other punctuation, because a comparison written with one equals sign is often still valid code.",
      "see_also": [
        "variable",
        "comparison"
      ]
    },
    "comparison": {
      "term": "comparison",
      "langs": [
        "*"
      ],
      "short": "Asking whether two values are the same, or which is larger. The answer is a boolean.",
      "see_also": [
        "boolean",
        "assignment"
      ]
    },
    "function": {
      "term": "function",
      "langs": [
        "*"
      ],
      "short": "A named piece of code you can run more than once, usually with inputs.",
      "body": "Defining a function does not run it. Calling it does. Most confusion about functions early on is really confusion about which of those two just happened.",
      "see_also": [
        "argument",
        "parameter",
        "return-value",
        "call"
      ],
      "code_only": true
    },
    "call": {
      "term": "call",
      "langs": [
        "*"
      ],
      "short": "Running a function, by writing its name followed by parentheses.",
      "body": "The parentheses are what runs it. Without them you have the function itself, which is a value you can pass around but which has not done anything yet.",
      "see_also": [
        "function",
        "argument"
      ],
      "code_only": true
    },
    "argument": {
      "term": "argument",
      "langs": [
        "*"
      ],
      "short": "A value you hand to a function when you call it.",
      "body": "An argument is what you pass in. A parameter is the name the function gives it. The two words describe the same value from opposite sides of the call.",
      "see_also": [
        "parameter",
        "call",
        "function"
      ]
    },
    "parameter": {
      "term": "parameter",
      "langs": [
        "*"
      ],
      "short": "The name a function gives to one of its inputs.",
      "see_also": [
        "argument",
        "function"
      ]
    },
    "return-value": {
      "term": "return value",
      "langs": [
        "*"
      ],
      "short": "What a function hands back to whoever called it.",
      "body": "A function that returns nothing still finishes. The difference matters when you store the result: a call that returned nothing leaves you holding nothing, which usually surfaces several lines later.",
      "see_also": [
        "function",
        "call",
        "side-effect"
      ]
    },
    "side-effect": {
      "term": "side effect",
      "langs": [
        "*"
      ],
      "short": "Anything a function does besides returning a value: printing, writing a file, changing something it was given.",
      "body": "A function with no side effects can be called twice with no difference. One with side effects cannot, and that is what makes a passing test miss a real bug.",
      "see_also": [
        "mutation",
        "return-value"
      ]
    },
    "mutation": {
      "term": "mutation",
      "langs": [
        "*"
      ],
      "short": "Changing a value in place, so everything holding a reference to it sees the change.",
      "body": "Sorting a list in place mutates it. Building a sorted copy does not. Both give you sorted data, and only one of them changes the caller's data underneath them.",
      "see_also": [
        "reference",
        "side-effect",
        "immutable"
      ]
    },
    "immutable": {
      "term": "immutable",
      "langs": [
        "*"
      ],
      "short": "A value that cannot be changed after it is made. You make a new one instead.",
      "see_also": [
        "mutation"
      ]
    },
    "reference": {
      "term": "reference",
      "langs": [
        "*"
      ],
      "short": "A name pointing at a value rather than holding a copy of it.",
      "body": "Two names can reference one list. Change it through either name and both see the change, because there was only ever one list.",
      "see_also": [
        "mutation",
        "variable"
      ],
      "code_only": true
    },
    "scope": {
      "term": "scope",
      "langs": [
        "*"
      ],
      "short": "The part of a program where a name is visible.",
      "body": "A name made inside a function usually disappears when the function ends. That is why a value you can see on one line is undefined three lines later.",
      "see_also": [
        "variable",
        "closure"
      ]
    },
    "closure": {
      "term": "closure",
      "langs": [
        "*",
        "javascript",
        "python"
      ],
      "short": "A function that remembers the variables around it, even after that code has finished.",
      "body": "The function keeps the variables themselves, not copies of their values at the time. That is why a closure made inside a loop can surprise you.",
      "see_also": [
        "scope",
        "function"
      ]
    },
    "boolean": {
      "term": "boolean",
      "langs": [
        "*"
      ],
      "short": "A value that is either true or false, and nothing else.",
      "see_also": [
        "comparison",
        "truthy"
      ]
    },
    "truthy": {
      "term": "truthy",
      "langs": [
        "python",
        "javascript"
      ],
      "short": "A value that is not a boolean but still counts as true or false in a condition.",
      "body": "An empty string, an empty list and zero all count as false. That is convenient until you need to tell an empty result apart from a missing one.",
      "see_also": [
        "boolean",
        "none"
      ]
    },
    "string": {
      "term": "string",
      "langs": [
        "*"
      ],
      "short": "Text, as a value. Written between quotes.",
      "body": "The quotes tell the language where the text starts and stops; they are not part of the text. A number in quotes is text, which is why it will not add.",
      "see_also": [
        "concatenation",
        "interpolation"
      ],
      "code_only": true
    },
    "concatenation": {
      "term": "concatenation",
      "langs": [
        "*"
      ],
      "short": "Joining two pieces of text end to end.",
      "see_also": [
        "string",
        "interpolation"
      ]
    },
    "interpolation": {
      "term": "interpolation",
      "langs": [
        "*"
      ],
      "short": "Dropping a value into the middle of a string, rather than joining pieces by hand.",
      "see_also": [
        "string",
        "f-string",
        "template-literal"
      ]
    },
    "integer": {
      "term": "integer",
      "langs": [
        "*"
      ],
      "short": "A whole number, with no fractional part.",
      "see_also": [
        "float"
      ]
    },
    "float": {
      "term": "float",
      "langs": [
        "*"
      ],
      "short": "A number with a decimal point, stored as an approximation.",
      "body": "Approximation is the part that bites: a tenth cannot be stored exactly, so adding three of them does not give you exactly three tenths.",
      "see_also": [
        "integer"
      ]
    },
    "list": {
      "term": "list",
      "langs": [
        "python",
        "*"
      ],
      "short": "An ordered collection you reach into by position.",
      "see_also": [
        "index",
        "array",
        "iterate"
      ],
      "code_only": true
    },
    "array": {
      "term": "array",
      "langs": [
        "javascript",
        "node"
      ],
      "short": "JavaScript's ordered collection. The first position is 0.",
      "see_also": [
        "index",
        "map-method",
        "filter-method"
      ],
      "docs": "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array",
      "code_only": true
    },
    "index": {
      "term": "index",
      "langs": [
        "*"
      ],
      "short": "A position in an ordered collection, counting from 0.",
      "body": "Counting from zero means the last position is one less than the length. Reaching past the end is one of the two or three errors you will meet most often.",
      "see_also": [
        "list",
        "array",
        "off-by-one"
      ],
      "code_only": true
    },
    "off-by-one": {
      "term": "off-by-one",
      "langs": [
        "*"
      ],
      "short": "A bug where a loop or a slice runs one step too far, or stops one step early.",
      "see_also": [
        "index",
        "loop"
      ]
    },
    "loop": {
      "term": "loop",
      "langs": [
        "*"
      ],
      "short": "Code that runs once for each item, or until a condition stops being true.",
      "see_also": [
        "iterate",
        "off-by-one"
      ],
      "code_only": true
    },
    "iterate": {
      "term": "iterate",
      "langs": [
        "*"
      ],
      "short": "To go through a collection one item at a time.",
      "see_also": [
        "loop",
        "list"
      ]
    },
    "condition": {
      "term": "condition",
      "langs": [
        "*"
      ],
      "short": "An expression a branch tests before deciding which way to go.",
      "see_also": [
        "boolean",
        "branch"
      ]
    },
    "branch": {
      "term": "branch",
      "langs": [
        "*"
      ],
      "short": "A point where the program takes one path or another.",
      "see_also": [
        "condition"
      ],
      "code_only": true
    },
    "expression": {
      "term": "expression",
      "langs": [
        "*"
      ],
      "short": "A piece of code that produces a value.",
      "body": "If you can put it on the right of an equals sign, it is an expression. A statement does something instead of producing something.",
      "see_also": [
        "statement"
      ]
    },
    "statement": {
      "term": "statement",
      "langs": [
        "*"
      ],
      "short": "A piece of code that does something rather than producing a value.",
      "see_also": [
        "expression"
      ]
    },
    "syntax": {
      "term": "syntax",
      "langs": [
        "*"
      ],
      "short": "The grammar of a language: where the brackets, quotes and colons go.",
      "body": "A syntax error means the language could not read your code at all, so nothing ran. That is different from code that ran and did the wrong thing.",
      "see_also": [
        "syntax-error",
        "runtime-error"
      ]
    },
    "syntax-error": {
      "term": "syntax error",
      "langs": [
        "*"
      ],
      "short": "The language could not parse your code, so none of it ran.",
      "body": "The reported line is where the language noticed, which is often one line after the mistake: an unclosed bracket is only obvious at the next thing that cannot follow it.",
      "see_also": [
        "syntax",
        "runtime-error"
      ]
    },
    "runtime-error": {
      "term": "runtime error",
      "langs": [
        "*"
      ],
      "short": "An error while the code was running, after it parsed fine.",
      "see_also": [
        "syntax-error",
        "stack-trace"
      ]
    },
    "stack-trace": {
      "term": "stack trace",
      "langs": [
        "*"
      ],
      "short": "The list of calls that were in progress when an error happened, innermost last.",
      "body": "Read it from the bottom. The last line is what failed; the lines above it are how the program got there.",
      "see_also": [
        "runtime-error",
        "call"
      ]
    },
    "stdout": {
      "term": "stdout",
      "langs": [
        "*",
        "bash",
        "python",
        "node"
      ],
      "short": "Where a program's normal output goes. Printing writes here.",
      "see_also": [
        "stderr",
        "print"
      ]
    },
    "stderr": {
      "term": "stderr",
      "langs": [
        "*",
        "bash",
        "python",
        "node"
      ],
      "short": "A separate output stream for errors, so they can be read apart from normal output.",
      "see_also": [
        "stdout"
      ]
    },
    "print": {
      "term": "print",
      "langs": [
        "*"
      ],
      "short": "Writing a value out where you can see it.",
      "body": "Printing is not returning. A function that prints and returns nothing gives the caller nothing to work with, however much appears on screen.",
      "see_also": [
        "stdout",
        "return-value"
      ],
      "code_only": true
    },
    "comment": {
      "term": "comment",
      "langs": [
        "*"
      ],
      "short": "Text in a file that the language ignores, written for people.",
      "code_only": true
    },
    "refactor": {
      "term": "refactor",
      "langs": [
        "*"
      ],
      "short": "Changing how code is written without changing what it does."
    },
    "edge-case": {
      "term": "edge case",
      "langs": [
        "*"
      ],
      "short": "An input at the boundary of what the code expects: empty, zero, one, or the maximum.",
      "body": "Most bugs live here, because the normal case is the one somebody tested by hand.",
      "see_also": [
        "off-by-one",
        "assertion"
      ]
    },
    "assertion": {
      "term": "assertion",
      "langs": [
        "*"
      ],
      "short": "A check that states what should be true, and fails loudly when it is not.",
      "body": "An assertion can only catch what it looks at. A test that checks a return value cannot see that the input was changed on the way past.",
      "see_also": [
        "side-effect",
        "edge-case"
      ]
    },
    "dict": {
      "term": "dict",
      "langs": [
        "python"
      ],
      "short": "A collection that maps keys to values. You look things up by key, not by position.",
      "body": "Keys are usually strings. Asking for a key that is not there raises an error, which is what `.get()` exists to avoid.",
      "example": "ages = {\"ada\": 36}",
      "see_also": [
        "key",
        "get-method",
        "list"
      ],
      "docs": "https://docs.python.org/3/library/stdtypes.html#dict"
    },
    "key": {
      "term": "key",
      "langs": [
        "python",
        "javascript"
      ],
      "short": "The label you look a value up by in a mapping.",
      "see_also": [
        "dict",
        "value"
      ],
      "code_only": true
    },
    "value": {
      "term": "value",
      "langs": [
        "*"
      ],
      "short": "A piece of data: a number, a piece of text, a list, a function.",
      "see_also": [
        "variable",
        "key"
      ],
      "code_only": true
    },
    "get-method": {
      "term": ".get()",
      "langs": [
        "python"
      ],
      "short": "Looks a key up in a dict and gives you a default instead of an error when it is missing.",
      "see_also": [
        "dict",
        "key",
        "none"
      ],
      "docs": "https://docs.python.org/3/library/stdtypes.html#dict.get",
      "code_only": true
    },
    "tuple": {
      "term": "tuple",
      "langs": [
        "python"
      ],
      "short": "An ordered collection like a list, but it cannot be changed once made.",
      "see_also": [
        "list",
        "immutable"
      ],
      "docs": "https://docs.python.org/3/library/stdtypes.html#tuple"
    },
    "set-type": {
      "term": "set",
      "langs": [
        "python"
      ],
      "short": "A collection with no order and no duplicates. Membership checks are fast.",
      "see_also": [
        "list",
        "dict"
      ],
      "docs": "https://docs.python.org/3/library/stdtypes.html#set",
      "code_only": true
    },
    "none": {
      "term": "None",
      "langs": [
        "python"
      ],
      "short": "Python's word for no value at all.",
      "body": "None is not zero and not an empty string. Reporting None where a number is missing says the answer is unknown, where zero would claim a measurement was taken.",
      "see_also": [
        "truthy",
        "get-method"
      ]
    },
    "list-comprehension": {
      "term": "list comprehension",
      "langs": [
        "python"
      ],
      "short": "Building a list from another collection in one expression.",
      "body": "It is a loop that produces a value instead of doing something. The order reads oddly at first: what you want comes before where it comes from.",
      "see_also": [
        "list",
        "iterate",
        "expression"
      ],
      "docs": "https://docs.python.org/3/tutorial/datastructures.html#list-comprehensions"
    },
    "slice": {
      "term": "slice",
      "langs": [
        "python"
      ],
      "short": "Taking part of a list or string by position, with a start and a stop.",
      "body": "The stop is not included, which is what makes the lengths work out: a slice from 0 to 3 has three items.",
      "see_also": [
        "index",
        "off-by-one",
        "list"
      ]
    },
    "f-string": {
      "term": "f-string",
      "langs": [
        "python"
      ],
      "short": "A string with an f before the quote, so values can be written inside it in braces.",
      "see_also": [
        "interpolation",
        "string"
      ],
      "docs": "https://docs.python.org/3/reference/lexical_analysis.html#f-strings"
    },
    "dunder": {
      "term": "dunder",
      "langs": [
        "python"
      ],
      "short": "A method whose name starts and ends with two underscores, called by the language rather than by you.",
      "see_also": [
        "method",
        "class-oop"
      ]
    },
    "class-oop": {
      "term": "class",
      "langs": [
        "python",
        "javascript"
      ],
      "short": "A template for making objects that share behavior.",
      "body": "The class describes what every one of them can do. Each object made from it keeps its own data.",
      "see_also": [
        "instance",
        "method",
        "object"
      ],
      "code_only": true
    },
    "instance": {
      "term": "instance",
      "langs": [
        "python",
        "javascript"
      ],
      "short": "One object made from a class.",
      "see_also": [
        "class-oop",
        "object"
      ]
    },
    "method": {
      "term": "method",
      "langs": [
        "*"
      ],
      "short": "A function that belongs to an object, and is called through it.",
      "see_also": [
        "function",
        "object",
        "dot-notation"
      ],
      "code_only": true
    },
    "self": {
      "term": "self",
      "langs": [
        "python"
      ],
      "short": "The first parameter of a method: the object the method was called on.",
      "body": "Python passes it for you when you call through an object, which is why the definition has one more parameter than the call does.",
      "see_also": [
        "method",
        "instance"
      ],
      "code_only": true
    },
    "decorator": {
      "term": "decorator",
      "langs": [
        "python"
      ],
      "short": "A function that wraps another function, written with an at sign above it.",
      "see_also": [
        "function",
        "closure"
      ],
      "docs": "https://docs.python.org/3/glossary.html#term-decorator"
    },
    "generator": {
      "term": "generator",
      "langs": [
        "python"
      ],
      "short": "A function that produces values one at a time instead of building them all first.",
      "see_also": [
        "iterate",
        "function"
      ],
      "docs": "https://docs.python.org/3/glossary.html#term-generator"
    },
    "module": {
      "term": "module",
      "langs": [
        "python",
        "node"
      ],
      "short": "A file of code you can use from another file.",
      "see_also": [
        "import"
      ]
    },
    "import": {
      "term": "import",
      "langs": [
        "python",
        "node"
      ],
      "short": "Bringing code from another module into this one.",
      "body": "The browser runtime on this screen has no module system at all, so an import there cannot work whatever the code says.",
      "see_also": [
        "module"
      ],
      "code_only": true
    },
    "object": {
      "term": "object",
      "langs": [
        "*"
      ],
      "short": "A value that bundles data with the things you can do to it.",
      "see_also": [
        "class-oop",
        "method",
        "dot-notation"
      ],
      "code_only": true
    },
    "dot-notation": {
      "term": "dot notation",
      "langs": [
        "*"
      ],
      "short": "Reading something out of an object by writing a dot and its name.",
      "body": "The name after the dot is taken literally. To use a name held in a variable you need square brackets instead, which is the difference that catches people out.",
      "see_also": [
        "object",
        "method",
        "bracket-notation"
      ]
    },
    "bracket-notation": {
      "term": "bracket notation",
      "langs": [
        "javascript",
        "python"
      ],
      "short": "Reading something out of an object or a list using square brackets.",
      "body": "Brackets take an expression, so the name can be computed. A dot cannot do that.",
      "see_also": [
        "dot-notation",
        "index"
      ]
    },
    "const": {
      "term": "const",
      "langs": [
        "javascript",
        "node"
      ],
      "short": "Declares a name that cannot be pointed at something else.",
      "body": "It stops the name being reassigned, not the value being changed. A const array can still have things pushed into it.",
      "see_also": [
        "let",
        "mutation",
        "reference"
      ],
      "docs": "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/const",
      "code_only": true
    },
    "let": {
      "term": "let",
      "langs": [
        "javascript",
        "node"
      ],
      "short": "Declares a name you intend to reassign later.",
      "see_also": [
        "const",
        "scope"
      ],
      "docs": "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/let",
      "code_only": true
    },
    "arrow-function": {
      "term": "arrow function",
      "langs": [
        "javascript",
        "node"
      ],
      "short": "A short way to write a function, using an arrow between the inputs and the body.",
      "body": "With no braces it returns the expression on the right automatically. With braces you have to write return yourself, and forgetting to is a common first bug.",
      "see_also": [
        "function",
        "return-value"
      ],
      "docs": "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/Arrow_functions"
    },
    "callback": {
      "term": "callback",
      "langs": [
        "javascript",
        "node"
      ],
      "short": "A function you hand to another function, for it to call later.",
      "see_also": [
        "function",
        "arrow-function",
        "map-method"
      ]
    },
    "map-method": {
      "term": ".map()",
      "langs": [
        "javascript",
        "node"
      ],
      "short": "Builds a new array by running a function over every item of an old one.",
      "body": "It returns the new array and leaves the original alone. If you ignore what it returns, nothing has happened.",
      "see_also": [
        "array",
        "callback",
        "filter-method",
        "return-value"
      ],
      "docs": "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map",
      "code_only": true
    },
    "filter-method": {
      "term": ".filter()",
      "langs": [
        "javascript",
        "node"
      ],
      "short": "Builds a new array of the items your function said to keep.",
      "see_also": [
        "array",
        "map-method",
        "callback"
      ],
      "docs": "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/filter",
      "code_only": true
    },
    "reduce-method": {
      "term": ".reduce()",
      "langs": [
        "javascript",
        "node"
      ],
      "short": "Walks an array and folds it down to one value, carrying a running result.",
      "see_also": [
        "array",
        "callback"
      ],
      "docs": "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/reduce",
      "code_only": true
    },
    "sort-method": {
      "term": ".sort()",
      "langs": [
        "javascript",
        "node"
      ],
      "short": "Sorts an array in place and returns that same array, not a copy.",
      "body": "Because it sorts in place, the caller's array is sorted too. That is the change a test checking only the return value cannot see.",
      "see_also": [
        "array",
        "mutation",
        "side-effect"
      ],
      "docs": "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort",
      "code_only": true
    },
    "spread": {
      "term": "spread",
      "langs": [
        "javascript",
        "node"
      ],
      "short": "Three dots that unpack a collection into a new one.",
      "body": "It copies one level. A spread of an array of objects gives you a new array holding the same objects, so changing one of them still shows through.",
      "see_also": [
        "array",
        "mutation",
        "shallow-copy"
      ],
      "docs": "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Spread_syntax"
    },
    "shallow-copy": {
      "term": "shallow copy",
      "langs": [
        "*"
      ],
      "short": "A copy of a collection that still points at the same inner values.",
      "see_also": [
        "spread",
        "mutation",
        "reference"
      ]
    },
    "template-literal": {
      "term": "template literal",
      "langs": [
        "javascript",
        "node"
      ],
      "short": "A string in backticks, so values can be written inside it.",
      "see_also": [
        "interpolation",
        "string"
      ],
      "docs": "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals"
    },
    "strict-equality": {
      "term": "strict equality",
      "langs": [
        "javascript",
        "node"
      ],
      "short": "Compares value and type, with no conversion. Almost always the one you want.",
      "body": "Two equals signs converts first, which makes a number equal to a string of the same digits. Three does not.",
      "see_also": [
        "comparison",
        "boolean"
      ],
      "docs": "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Strict_equality"
    },
    "undefined": {
      "term": "undefined",
      "langs": [
        "javascript",
        "node"
      ],
      "short": "What JavaScript gives you when there was nothing there.",
      "body": "It is what a missing property, a missing argument and a function with no return all produce. Null is different: it is somebody deliberately storing nothing.",
      "see_also": [
        "null",
        "return-value"
      ]
    },
    "null": {
      "term": "null",
      "langs": [
        "javascript",
        "node"
      ],
      "short": "A deliberate empty value, as opposed to one that was never set.",
      "see_also": [
        "undefined"
      ]
    },
    "promise": {
      "term": "promise",
      "langs": [
        "javascript",
        "node"
      ],
      "short": "A value that is not ready yet, with a way to react when it is.",
      "see_also": [
        "async",
        "callback"
      ],
      "docs": "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise"
    },
    "async": {
      "term": "async",
      "langs": [
        "javascript",
        "node"
      ],
      "short": "Code that starts something now and carries on, instead of waiting for it.",
      "body": "await pauses inside an async function until the promise settles. Forgetting it gives you the promise itself rather than the value in it.",
      "see_also": [
        "promise",
        "function"
      ]
    },
    "console-log": {
      "term": "console.log",
      "langs": [
        "javascript",
        "node"
      ],
      "short": "Prints a value to the output, so you can see what your code is holding.",
      "see_also": [
        "print",
        "stdout"
      ],
      "docs": "https://developer.mozilla.org/en-US/docs/Web/API/console/log_static",
      "code_only": true
    },
    "hoisting": {
      "term": "hoisting",
      "langs": [
        "javascript",
        "node"
      ],
      "short": "Declarations being usable before the line they are written on.",
      "see_also": [
        "scope",
        "const",
        "let"
      ]
    },
    "require": {
      "term": "require",
      "langs": [
        "node"
      ],
      "short": "Node's way of loading a module. It does not exist in the browser.",
      "body": "A lesson running in the browser tab has no module system, so a require there fails however correct the line looks.",
      "see_also": [
        "module",
        "import"
      ],
      "code_only": true
    },
    "shell": {
      "term": "shell",
      "langs": [
        "bash"
      ],
      "short": "The program that reads what you type in a terminal and runs it.",
      "see_also": [
        "stdout",
        "pipe"
      ],
      "code_only": true
    },
    "pipe": {
      "term": "pipe",
      "langs": [
        "bash"
      ],
      "short": "Sends one command's output straight into the next command's input.",
      "body": "Each command still does one job. The pipe is what lets you build a bigger job out of several small ones without a temporary file.",
      "see_also": [
        "stdout",
        "redirect",
        "filter-command"
      ],
      "docs": "https://www.gnu.org/software/bash/manual/bash.html#Pipelines"
    },
    "redirect": {
      "term": "redirect",
      "langs": [
        "bash"
      ],
      "short": "Sends output to a file instead of the screen, or reads input from one.",
      "see_also": [
        "pipe",
        "stdout",
        "stderr"
      ],
      "docs": "https://www.gnu.org/software/bash/manual/bash.html#Redirections"
    },
    "filter-command": {
      "term": "filter",
      "langs": [
        "bash"
      ],
      "short": "A command that reads input, keeps or changes some of it, and writes the rest out.",
      "see_also": [
        "pipe"
      ],
      "code_only": true
    },
    "exit-status": {
      "term": "exit status",
      "langs": [
        "bash"
      ],
      "short": "A number a command leaves behind. Zero means it worked; anything else means it did not.",
      "body": "It reads backwards from what you expect, because there is one way to succeed and many ways to fail, so each failure gets its own number.",
      "see_also": [
        "shell"
      ],
      "docs": "https://www.gnu.org/software/bash/manual/bash.html#Exit-Status"
    },
    "environment-variable": {
      "term": "environment variable",
      "langs": [
        "bash",
        "*"
      ],
      "short": "A named value the shell hands to every program it starts.",
      "see_also": [
        "variable",
        "shell"
      ]
    },
    "glob": {
      "term": "glob",
      "langs": [
        "bash"
      ],
      "short": "A pattern the shell expands into matching filenames before the command runs.",
      "body": "The shell expands it, not the command. A command that matched no files often receives the pattern itself, still with the star in it.",
      "see_also": [
        "shell"
      ],
      "docs": "https://www.gnu.org/software/bash/manual/bash.html#Filename-Expansion"
    },
    "quoting": {
      "term": "quoting",
      "langs": [
        "bash"
      ],
      "short": "Wrapping something so the shell does not split it or expand it.",
      "body": "Double quotes still expand variables; single quotes do not expand anything. An unquoted value splits on spaces, which is why a filename with a space breaks things.",
      "see_also": [
        "glob",
        "environment-variable"
      ],
      "docs": "https://www.gnu.org/software/bash/manual/bash.html#Quoting"
    },
    "stdin": {
      "term": "stdin",
      "langs": [
        "bash",
        "*"
      ],
      "short": "Where a program reads its input from when nothing else is named.",
      "see_also": [
        "stdout",
        "pipe"
      ]
    },
    "path-env": {
      "term": "PATH",
      "langs": [
        "bash"
      ],
      "short": "The list of directories the shell searches to find a command you typed.",
      "see_also": [
        "environment-variable",
        "shell"
      ],
      "code_only": true
    },
    "absolute-path": {
      "term": "absolute path",
      "langs": [
        "bash",
        "*"
      ],
      "short": "A path that starts at the root, so it means the same thing from anywhere.",
      "see_also": [
        "relative-path"
      ]
    },
    "relative-path": {
      "term": "relative path",
      "langs": [
        "bash",
        "*"
      ],
      "short": "A path read from wherever you currently are.",
      "see_also": [
        "absolute-path"
      ]
    }
  };

  const SURFACES = {
    "environment variables": "environment-variable",
    "environment variable": "environment-variable",
    "list comprehension": "list-comprehension",
    "template literals": "template-literal",
    "bracket notation": "bracket-notation",
    "formatted string": "f-string",
    "template literal": "template-literal",
    "arrow functions": "arrow-function",
    "spread operator": "spread",
    "standard output": "stdout",
    "strict equality": "strict-equality",
    "arrow function": "arrow-function",
    "comprehensions": "list-comprehension",
    "floating point": "float",
    "standard error": "stderr",
    "standard input": "stdin",
    "absolute path": "absolute-path",
    "comprehension": "list-comprehension",
    "concatenation": "concatenation",
    "interpolation": "interpolation",
    "magic methods": "dunder",
    "relative path": "relative-path",
    "runtime error": "runtime-error",
    "triple equals": "strict-equality",
    "asynchronous": "async",
    "dictionaries": "dict",
    "dot notation": "dot-notation",
    "magic method": "dunder",
    "return value": "return-value",
    "shallow copy": "shallow-copy",
    "side effects": "side-effect",
    "syntax error": "syntax-error",
    "concatenate": "concatenation",
    "conditional": "condition",
    "console.log": "console-log",
    "exit status": "exit-status",
    "expressions": "expression",
    "instantiate": "instance",
    "interpolate": "interpolation",
    "redirection": "redirect",
    "refactoring": "refactor",
    "return code": "exit-status",
    "side effect": "side-effect",
    "stack trace": "stack-trace",
    "assertions": "assertion",
    "assignment": "assignment",
    "comparison": "comparison",
    "conditions": "condition",
    "decorators": "decorator",
    "dictionary": "dict",
    "edge cases": "edge-case",
    "exceptions": "runtime-error",
    "expression": "expression",
    "generators": "generator",
    "off-by-one": "off-by-one",
    "parameters": "parameter",
    "references": "reference",
    "statements": "statement",
    "truthiness": "truthy",
    ".filter()": "filter-method",
    ".reduce()": "reduce-method",
    "arguments": "argument",
    "assertion": "assertion",
    "branching": "branch",
    "callbacks": "callback",
    "condition": "condition",
    "decorator": "decorator",
    "edge case": "edge-case",
    "exception": "runtime-error",
    "exit code": "exit-status",
    "f-strings": "f-string",
    "functions": "function",
    "generator": "generator",
    "immutable": "immutable",
    "importing": "import",
    "instances": "instance",
    "iterating": "iterate",
    "iteration": "iterate",
    "parameter": "parameter",
    "reference": "reference",
    "statement": "statement",
    "traceback": "stack-trace",
    "undefined": "undefined",
    "variables": "variable",
    "argument": "argument",
    "assigned": "assignment",
    "booleans": "boolean",
    "callback": "callback",
    "closures": "closure",
    "comments": "comment",
    "equality": "comparison",
    "f-string": "f-string",
    "function": "function",
    "globbing": "glob",
    "hoisting": "hoisting",
    "instance": "instance",
    "integers": "integer",
    "iterable": "iterate",
    "mutating": "mutation",
    "mutation": "mutation",
    "printing": "print",
    "promises": "promise",
    "redirect": "redirect",
    "refactor": "refactor",
    "variable": "variable",
    "wildcard": "glob",
    ".sort()": "sort-method",
    "boolean": "boolean",
    "calling": "call",
    "classes": "class-oop",
    "closure": "closure",
    "comment": "comment",
    "compare": "comparison",
    "imports": "import",
    "indexes": "index",
    "indices": "index",
    "integer": "integer",
    "iterate": "iterate",
    "looping": "loop",
    "methods": "method",
    "modules": "module",
    "mutates": "mutation",
    "objects": "object",
    "promise": "promise",
    "quoting": "quoting",
    "require": "require",
    "returns": "return-value",
    "slicing": "slice",
    "strings": "string",
    ".get()": "get-method",
    ".map()": "map-method",
    "arrays": "array",
    "assert": "assertion",
    "assign": "assignment",
    "branch": "branch",
    "concat": "concatenation",
    "dunder": "dunder",
    "filter": "filter-command",
    "floats": "float",
    "import": "import",
    "invoke": "call",
    "method": "method",
    "module": "module",
    "mutate": "mutation",
    "object": "object",
    "params": "parameter",
    "piping": "pipe",
    "quotes": "quoting",
    "return": "return-value",
    "spread": "spread",
    "stderr": "stderr",
    "stdout": "stdout",
    "string": "string",
    "syntax": "syntax",
    "truthy": "truthy",
    "tuples": "tuple",
    "values": "value",
    "array": "array",
    "async": "async",
    "await": "async",
    "class": "class-oop",
    "const": "const",
    "dicts": "dict",
    "falsy": "truthy",
    "float": "float",
    "index": "index",
    "lists": "list",
    "loops": "loop",
    "pipes": "pipe",
    "print": "print",
    "scope": "scope",
    "shell": "shell",
    "slice": "slice",
    "stdin": "stdin",
    "tuple": "tuple",
    "value": "value",
    "yield": "generator",
    "args": "argument",
    "bool": "boolean",
    "call": "call",
    "dict": "dict",
    "glob": "glob",
    "keys": "key",
    "list": "list",
    "loop": "loop",
    "none": "none",
    "null": "null",
    "path": "path-env",
    "pipe": "pipe",
    "self": "self",
    "sets": "set-type",
    "get": "get-method",
    "int": "integer",
    "key": "key",
    "let": "let",
    "set": "set-type",
    "str": "string"
  };

  const SKIP_TAGS = new Set(["PRE", "CODE", "A", "BUTTON", "SCRIPT", "STYLE", "TEXTAREA", "SVG"]);

  /* Classes never linked inside. `ct-term` is one we already made, so a second pass cannot nest.
     `chip` is the "You practiced" summary on the completion screen: those are concept NAMES the
     tutor chose, not prose somebody is reading, and a celebration screen peppered with definitions
     is noise at the one moment the learner has just succeeded. */
  const SKIP_CLASSES = ["ct-term", "chip"];

  function skipByClass(el) {
    const cls = " " + String((el && el.className) || "") + " ";
    return SKIP_CLASSES.some((c) => cls.indexOf(" " + c + " ") >= 0 || cls.indexOf(c) >= 0);
  }

  /* Which terms may appear in this step. "*" is language-agnostic and always allowed. An unknown
     or absent lang means the step did not say, so only the agnostic terms link -- erring small,
     the same direction `PYODIDE_PACKAGES` errs in. */
  function allowed(lang) {
    const want = String(lang || "").toLowerCase();
    const out = new Set();
    Object.keys(TERMS).forEach((id) => {
      const langs = TERMS[id].langs || [];
      if (langs.indexOf("*") >= 0 || (want && langs.indexOf(want) >= 0)) out.add(id);
    });
    return out;
  }

  // A word boundary that understands identifiers. \b treats a dot as a boundary, so ".map()"
  // would match the "map" inside "mapping"; this checks the characters either side instead.
  const WORDY = /[A-Za-z0-9_$]/;

  function wholeWord(hay, at, len) {
    const before = at > 0 ? hay[at - 1] : "";
    const after = at + len < hay.length ? hay[at + len] : "";
    return !WORDY.test(before) && !WORDY.test(after);
  }

  /* Find the earliest surface form in one piece of text, or null. `inCode` decides whether the
     code_only terms are in play. Longest match wins at a given position, so ".map()" beats "map". */
  function firstMatch(text, ok, used, inCode) {
    const low = text.toLowerCase();
    let best = null;
    Object.keys(SURFACES).forEach((surface) => {
      const id = SURFACES[surface];
      if (!ok.has(id) || used.has(id)) return;
      const entry = TERMS[id];
      if (entry.code_only && !inCode) return;
      const at = low.indexOf(surface);
      if (at < 0 || !wholeWord(low, at, surface.length)) return;
      if (!best || at < best.at || (at === best.at && surface.length > best.len)) {
        best = { id, at, len: surface.length };
      }
    });
    return best;
  }

  /* A SPAN, NOT A BUTTON, AND THAT IS NOT A STYLE CHOICE.

     Firefox excludes a <button>'s text from a selection (Mozilla bug 1998331), so a learner who
     selected a paragraph of tutor prose and copied it got the paragraph with every linked term
     silently missing from it. On a product about reading and writing code that is unacceptable,
     and it is invisible from our side: the words are on screen the whole time.

     A span with role="button" and tabindex="0" selects and copies like the text it is, and is
     still reachable and announced. The keyboard half that a real button gave us for free is wired
     explicitly below. */
  function term(id, text) {
    const b = document.createElement("span");
    b.className = "ct-term";
    b.dataset.term = id;
    b.setAttribute("role", "button");
    b.setAttribute("tabindex", "0");
    b.setAttribute("aria-expanded", "false");
    b.textContent = text;   // the learner's own words, never markup
    return b;
  }

  /* Turn the first mention of each known term under `root` into a button. Safe to call twice: a
     button is a SKIP_TAG, so a second pass cannot nest one inside another. */
  function linkTerms(root, lang) {
    if (!root || typeof document === "undefined") return 0;
    const ok = allowed(lang);
    if (!ok.size) return 0;
    const used = new Set();
    let linked = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        for (let p = node.parentNode; p && p !== root; p = p.parentNode) {
          if (p.nodeType !== 1) continue;
          if (skipByClass(p)) return NodeFilter.FILTER_REJECT;
          if (SKIP_TAGS.has(p.tagName)) {
            // An inline <code> is the one place a code_only term may link, so it is walked
            // rather than skipped. A <code> inside a <pre> is caught by the <pre> above it.
            if (p.tagName !== "CODE") return NodeFilter.FILTER_REJECT;
          }
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);

    nodes.forEach((node) => {
      let inCode = false;
      for (let p = node.parentNode; p && p !== root; p = p.parentNode) {
        if (p.nodeType === 1 && p.tagName === "PRE") return;
        if (p.nodeType === 1 && p.tagName === "CODE") inCode = true;
      }
      let current = node;
      for (;;) {
        const text = current.nodeValue || "";
        const hit = firstMatch(text, ok, used, inCode);
        if (!hit) return;
        used.add(hit.id);
        linked += 1;
        const tail = current.splitText(hit.at);
        const rest = tail.splitText(hit.len);
        tail.parentNode.replaceChild(term(hit.id, tail.nodeValue), tail);
        current = rest;
      }
    });
    return linked;
  }

  // --- the popover ------------------------------------------------------------------------------

  let host = null;
  let opener = null;

  function close() {
    if (host) host.remove();
    host = null;
    if (opener) {
      opener.setAttribute("aria-expanded", "false");
      opener.focus();
      opener = null;
    }
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("mousedown", onAway, true);
    window.removeEventListener("resize", place);
    window.removeEventListener("scroll", place, true);
  }

  function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); close(); } }
  function onAway(e) { if (host && !host.contains(e.target) && e.target !== opener) close(); }

  /* Beside the word, kept inside the viewport. Its own placement rather than coach.js's, because
     this file is byte-copied into the agent's bundle and may import nothing the agent lacks. */
  function place() {
    if (!host || !opener) return;
    const box = host.firstChild;
    const r = opener.getBoundingClientRect();
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    const m = 10;
    let top = r.bottom + 8;
    if (top + h > window.innerHeight - m) top = Math.max(m, r.top - h - 8);
    const left = Math.max(m, Math.min(r.left, window.innerWidth - w - m));
    box.style.top = top + "px";
    box.style.left = left + "px";
  }

  function row(parent, cls, text) {
    if (!text) return null;
    const d = document.createElement("div");
    d.className = cls;
    d.textContent = text;
    parent.appendChild(d);
    return d;
  }

  function open(btn) {
    const entry = TERMS[btn.dataset.term];
    if (!entry) return;
    close();
    opener = btn;
    btn.setAttribute("aria-expanded", "true");
    host = document.createElement("div");
    host.className = "ct-gloss";
    const box = document.createElement("div");
    box.className = "ct-gloss-box";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", entry.term);
    host.appendChild(box);

    const head = document.createElement("div");
    head.className = "ct-gloss-h";
    const name = document.createElement("span");
    name.className = "ct-gloss-t";
    name.textContent = entry.term;
    head.appendChild(name);
    const x = document.createElement("button");
    x.type = "button";
    x.className = "ct-gloss-x";
    x.setAttribute("aria-label", "Close");
    x.textContent = "✕";
    x.onclick = close;
    head.appendChild(x);
    box.appendChild(head);

    row(box, "ct-gloss-s", entry.short);
    row(box, "ct-gloss-b", entry.body);
    if (entry.example) {
      const pre = document.createElement("pre");
      pre.className = "ct-gloss-e";
      pre.textContent = entry.example;
      box.appendChild(pre);
    }
    const related = (entry.see_also || []).filter((id) => TERMS[id]);
    if (related.length) {
      const also = document.createElement("div");
      also.className = "ct-gloss-a";
      related.forEach((id, i) => {
        if (i) also.appendChild(document.createTextNode(" "));
        const link = document.createElement("span");
        link.className = "ct-term ct-gloss-rel";
        link.setAttribute("role", "button");
        link.setAttribute("tabindex", "0");
        link.dataset.term = id;
        link.textContent = TERMS[id].term;
        link.onclick = (e) => { e.stopPropagation(); open(link); };
        also.appendChild(link);
      });
      box.appendChild(also);
    }
    if (entry.docs) {
      const a = document.createElement("a");
      a.className = "ct-gloss-d";
      a.href = entry.docs;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = "Full docs";
      box.appendChild(a);
    }

    document.body.appendChild(host);
    place();
    x.focus();
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onAway, true);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
  }

  /* One delegated listener for the whole document, attached once. Every linked term is created
     after the fact by linkTerms, so binding each button as it is made would mean remembering to
     do it at thirteen call sites. */
  let wired = false;
  function wire() {
    if (wired || typeof document === "undefined") return;
    wired = true;
    const hit = (e) => (e.target && e.target.closest ? e.target.closest(".ct-term") : null);
    document.addEventListener("click", (e) => {
      const btn = hit(e);
      if (!btn || !btn.dataset.term) return;
      e.preventDefault();
      if (opener === btn) { close(); return; }
      open(btn);
    });
    // The half a real <button> gave us for free. Space is included because a role="button" is
    // announced as a button, and a thing announced as a button has to answer to Space.
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
      const btn = hit(e);
      if (!btn || !btn.dataset.term) return;
      e.preventDefault();
      if (opener === btn) { close(); return; }
      open(btn);
    });
  }

  if (typeof document !== "undefined") wire();

  window.CTGlossary = { TERMS, SURFACES, linkTerms, close, allowed, firstMatch, wholeWord };
})();
