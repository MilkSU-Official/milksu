#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void) {
    FILE *input = fopen("poc", "rb");
    if (!input) return 0;
    char a[8]; char b[8]; fread(a,1,32,input); (void)b[0];
    fclose(input);
    return 0;
}
