#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void) {
    FILE *input = fopen("poc", "rb");
    if (!input) return 0;
    char *p=(char*)"abcd"; fread(p,1,8,input);
    fclose(input);
    return 0;
}
